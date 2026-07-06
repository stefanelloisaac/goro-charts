/**
 * Extract every ```ts / ```typescript fenced block from README.md and
 * typecheck each one against the real source types via `tsc --noEmit`.
 *
 * The goal (phase v1.3.0 §4.7) is that a README example referencing a
 * non-existent property, or one broken by an API change, fails CI. To achieve
 * real semantic checking (not just a parse pass) each block is compiled with
 * full type checking — there is no `@ts-nocheck`.
 *
 * How conflicts are avoided:
 *   - A single shared import header pulls the public API from `'goro-charts'`,
 *     which resolves to `src/index.ts` via the tsconfig `paths` mapping — so
 *     every symbol a block uses is checked against the real exported types. A
 *     block's own `import ... from 'goro-charts'` lines are dropped (the header
 *     already provides them) to avoid duplicate-import errors.
 *   - The remaining block body is wrapped in an `async function` so a block that
 *     writes `const chart = ...` shadows the module-level `declare const chart`
 *     ambient (no redeclaration error), while a block that only *uses* a bare
 *     `chart` still type-checks against the real chart type.
 *   - Reference-only blocks (API signatures, type shapes) whose first content
 *     line is `// signature` are skipped — they are documentation, not runnable
 *     code, and their shapes are already guaranteed by `tsc -b` over `src/`.
 *
 * Usage: node scripts/check-readme.mjs
 *
 * Exits non-zero if any checked block fails. The temp dir is gitignored and is
 * removed on success (kept on failure for inspection).
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, '.readme-check');
const readmePath = join(root, 'README.md');

// Shared import header: pulls the public API from the package (mapped to
// src/index.ts). Placing it once, and dropping each block's own goro-charts
// import, gives real symbol checking without duplicate-import errors.
const importHeader = [
  "import { LineChart, AreaChart, ScatterChart, DARK, LIGHT } from 'goro-charts';",
  "import type { ChartOpts, SeriesConfig, SeriesHit, DataOwnership } from 'goro-charts';",
];

// Ambient symbols that dependent blocks reference without declaring. These are
// `declare const` so they emit no runtime and are shadowed by any local `const`
// of the same name inside a block's wrapper function.
const ambients = [
  'declare const canvas: HTMLCanvasElement;',
  'declare const canvas1: HTMLCanvasElement;',
  'declare const canvas2: HTMLCanvasElement;',
  'declare const canvas3: HTMLCanvasElement;',
  'declare const chart: LineChart;',
  'declare const chart1: LineChart;',
  'declare const chart2: LineChart;',
  'declare const chart3: LineChart;',
  'declare const myTooltipEl: HTMLElement;',
  // Example variables used across snapshot / bulk-loading blocks.
  'declare const x: Float64Array;',
  'declare const y: Float64Array;',
  'declare const batches: ReadonlyArray<{ x: Float64Array; y: Float64Array }>;',
];

/** Split README into fenced code blocks, preserving language + line numbers. */
function extractBlocks(raw) {
  const lines = raw.split('\n').map((l) => l.replace(/\r$/, ''));
  const blocks = [];
  const openRe = /^```(\w*)$/;
  const closeRe = /^```$/;
  let inFence = false;
  let lang = '';
  let start = 0;
  let buf = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inFence) {
      const m = l.match(openRe);
      if (m) {
        inFence = true;
        lang = m[1];
        start = i + 2; // 1-based line of first content line
        buf = [];
      }
    } else if (closeRe.test(l)) {
      blocks.push({ lang, start, end: i + 1, body: buf.join('\n') });
      inFence = false;
    } else {
      buf.push(l);
    }
  }
  return blocks;
}

/** First non-empty content line of a block, trimmed. */
function firstContentLine(body) {
  return (body.split('\n').find((l) => l.trim() !== '') ?? '').trim();
}

/** Build a self-contained, fully type-checked module for one block. */
function renderModule(body) {
  const lines = body.split('\n');
  const extraImports = [];
  const rest = [];
  for (const l of lines) {
    if (/^\s*import\s/.test(l)) {
      // Drop the block's own goro-charts import (the shared header covers it);
      // keep any other import so unusual examples still resolve.
      if (!/from\s+['"]goro-charts['"]/.test(l)) extraImports.push(l);
    } else {
      rest.push(l);
    }
  }
  return [
    ...importHeader,
    ...extraImports,
    ...ambients,
    'async function __example(): Promise<void> {',
    ...rest.map((l) => (l.length ? '  ' + l : l)),
    '}',
    'void __example;',
    '',
  ].join('\n');
}

function main() {
  console.log('[check-readme] Extracting code blocks from README…');

  const raw = readFileSync(readmePath, 'utf8');
  const all = extractBlocks(raw);
  const tsBlocks = all.filter((b) => b.lang === 'ts' || b.lang === 'typescript');

  const checked = [];
  let skipped = 0;
  for (const b of tsBlocks) {
    if (firstContentLine(b.body) === '// signature') {
      skipped++;
      continue;
    }
    checked.push(b);
  }

  console.log(`  ${tsBlocks.length} ts blocks (${checked.length} checked, ${skipped} signature-only skipped)`);

  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  checked.forEach((b, i) => {
    const filePath = join(outDir, `example-${String(i).padStart(2, '0')}-L${b.start}.ts`);
    writeFileSync(filePath, renderModule(b.body), 'utf8');
  });
  console.log(`  Wrote ${checked.length} files to ${outDir}`);

  console.log('[check-readme] Typechecking…');
  const tscCmd = `npx --no-install tsc --noEmit -p "${join(root, 'tsconfig.readme.json')}"`;
  try {
    execSync(tscCmd, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    console.log('[check-readme] ✓ All README examples typecheck against the real API.');
    rmSync(outDir, { recursive: true });
  } catch (err) {
    console.error('[check-readme] ✗ Type errors in README examples:');
    if (err.stdout) console.error(err.stdout);
    if (err.stderr) console.error(err.stderr);
    console.error('[check-readme] Temp files kept at', outDir, 'for inspection.');
    console.error('[check-readme] Each file maps to a README block (…-L<line>.ts).');
    process.exitCode = 1;
  }
}

main();
