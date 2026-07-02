/**
 * Quick performance benchmark for goro-charts streaming modes.
 *
 * Usage: node scripts/bench.mjs
 *
 * Creates a headless canvas, appends N points per series across M series,
 * and reports ops/sec and draw timing.
 */

import { createCanvas } from 'node:canvas';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// We resolve the dist build; adjust if running from source via tsx
const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '..', 'dist', 'goro-charts.js');

async function main() {
  const mod = await import(distPath);
  const { LineChart, AreaChart, ScatterChart } = mod;

  const canvas = createCanvas(800, 400);
  const POINTS = 100_000;
  const SERIES = 3;

  console.log(`\n=== Goro Charts Benchmark ===`);
  console.log(`Series: ${SERIES}, Points per series: ${POINTS.toLocaleString()}\n`);

  // --- LineChart streaming ---
  {
    const chart = new LineChart(canvas, {
      series: Array.from({ length: SERIES }, (_, i) => ({
        name: `S${i}`,
        color: `hsl(${i * 60}, 80%, 60%)`,
      })),
      maxPoints: POINTS,
      autoDraw: false,
    });

    const t0 = performance.now();
    for (let i = 0; i < POINTS; i++) {
      for (let s = 0; s < SERIES; s++) {
        chart.append(s, i, Math.sin(i * 0.01 + s) * 50 + 50);
      }
    }
    chart.draw();
    const dt = performance.now() - t0;
    const ops = (POINTS * SERIES) / (dt / 1000);
    console.log(`LineChart streaming  | ${POINTS.toLocaleString()} pts × ${SERIES} series`);
    console.log(`  Total: ${dt.toFixed(1)} ms  |  ${(ops / 1000).toFixed(0)}k ops/sec\n`);

    chart.destroy();
  }

  // --- LineChart snapshot (setData) ---
  {
    const chart = new LineChart(canvas, { autoDraw: false });
    const xs = new Float64Array(POINTS);
    const ys = new Float64Array(POINTS);
    for (let i = 0; i < POINTS; i++) {
      xs[i] = i;
      ys[i] = Math.sin(i * 0.01) * 50 + 50;
    }

    const t0 = performance.now();
    chart.setData(0, xs, ys);
    chart.draw();
    const dt = performance.now() - t0;
    console.log(`LineChart snapshot   | ${POINTS.toLocaleString()} pts`);
    console.log(`  Total: ${dt.toFixed(1)} ms\n`);

    chart.destroy();
  }

  // --- AreaChart ---
  {
    const chart = new AreaChart(canvas, {
      series: [{ name: 'Area', color: '#4ea8ff', fillColor: '#4ea8ff', fillOpacity: 0.12 }],
      maxPoints: POINTS,
      autoDraw: false,
    });

    const t0 = performance.now();
    for (let i = 0; i < POINTS; i++) {
      chart.append(0, i, Math.sin(i * 0.01) * 50 + 50);
    }
    chart.draw();
    const dt = performance.now() - t0;
    console.log(`AreaChart streaming  | ${POINTS.toLocaleString()} pts`);
    console.log(`  Total: ${dt.toFixed(1)} ms\n`);

    chart.destroy();
  }

  // --- ScatterChart ---
  {
    const chart = new ScatterChart(canvas, {
      maxPoints: POINTS,
      autoDraw: false,
    });

    const t0 = performance.now();
    for (let i = 0; i < Math.min(POINTS, 5000); i++) {
      chart.append(0, i, Math.random() * 100);
    }
    chart.draw();
    const dt = performance.now() - t0;
    console.log(`ScatterChart stream  | ${Math.min(POINTS, 5000).toLocaleString()} pts`);
    console.log(`  Total: ${dt.toFixed(1)} ms\n`);

    chart.destroy();
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Bench failed:', err.message);
  console.log('\nNote: bench requires node-canvas. Install with: npm install --save-dev canvas');
});
