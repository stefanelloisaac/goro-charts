# AGENTS.md — goro-charts

Minimal, dependency-free Canvas 2D chart engine (line / area / scatter) with streaming, decimation, dual-Y, dpr-aware rendering. TypeScript library, framework-agnostic. Ships an ES-only bundle from `src/index.ts`.

## Commands

Requires **Node ≥ 24** (see `package.json` engines). npm scripts:

| Script                                             | What it does                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                      | Vite dev server against `index.html` + `demo/`                                                                                                                                                                                                                                            |
| `npm run build`                                    | Library build → `dist/goro-charts.js` + `.d.ts`. Runs `vite build`, then `tsc -p tsconfig.build.json`, then `scripts/fix-dts-imports.mjs` to rewrite emitted `.ts` import extensions to `.js` (TS 6.0 still emits `.ts` under `verbatimModuleSyntax` + `rewriteRelativeImportExtensions`) |
| `npm run build:demo`                               | Static demo site → `dist-demo/` (config `vite.demo.config.ts`, `base` defaults to `/goro-charts/`, override with `DEMO_BASE=/`)                                                                                                                                                           |
| `npm run typecheck`                                | `tsc -b` (project references in `tsconfig.json`)                                                                                                                                                                                                                                          |
| `npm run lint`                                     | ESLint over the repo (`eslint.config.js`, flat config; ignores `dist`, `dist-demo`, `coverage`, `.readme-check`)                                                                                                                                                                          |
| `npm run test`                                     | Vitest single run (`vitest run`)                                                                                                                                                                                                                                                          |
| `npm run test:watch` / `test:ui` / `test:coverage` | Vitest variants                                                                                                                                                                                                                                                                           |
| `npm run check:readme`                             | Extracts every ` ```ts ` / ` ```typescript ` fence from `README.md` and typechecks it against real `src/` types via `scripts/check-readme.mjs`. **CI-blocking.** Blocks starting with `// signature` are skipped as documentation-only                                                    |
| `npm run bench`                                    | `node scripts/bench.mjs` — expects `dist/` to exist; runs a headless canvas benchmark. Optional `canvas` peer, not in devDeps                                                                                                                                                             |
| `npm run fix:all`                                  | `eslint --fix .` + `prettier --write .`                                                                                                                                                                                                                                                   |

CI (`.github/workflows/ci.yml`) runs, in order: `lint → check:readme → typecheck → test → build`. All must pass.

## Code layout

```
src/
  index.ts          Public entry — the ONLY module consumers may import. Anything not re-exported here is implementation detail.
  types.ts          Public + internal types (ChartOpts, SeriesConfig, PlotRect, Domain, SeriesView, event map, …)
  defaults.ts       CHART_DEFAULTS merged over user opts
  presets.ts        DARK / LIGHT preset objects
  charts/           High-level chart classes (LineChart, AreaChart, ScatterChart) — all extend ChartBase
    chart-base.ts   The orchestrator. Owns stores, surface, rAF loop, pointer/keyboard, dual-Y, stacking, events. Subclasses only implement `renderSeries()`.
  data/             Data model (no canvas):
    series-store.ts SeriesStore — implements SeriesView. Snapshot mode OR ring mode.
    ring-buffer.ts  Fixed-capacity ring, O(1) append, O(1) window min/max via MonotonicExtent.
    monotonic-extent.ts  Sliding-window min/max deques.
  render/           Pure Canvas 2D renderers (no state, no scheduling):
    surface.ts      Visible canvas + offscreen static-layer buffer + DPR transform.
    axes.ts, line.ts, area.ts, scatter.ts, stacked-band.ts, crosshair.ts, legend.ts, shape.ts
  math/             format.ts, scale.ts (data↔px), ticks.ts (linear + time-aware), window.ts (visible-range bracketing for renderers)
demo/               Static demo (JS, imports built lib). Included in tsconfig.app.json's `include`.
docs/               vision.md, improvements.md, addons.md, phases/ (roadmap).
scripts/            bench.mjs, check-readme.mjs, fix-dts-imports.mjs
```

## Architecture

- **Layered contract**: `charts/` orchestrates → `data/` stores data → `render/` produces pixels → `math/` provides transforms. Renderers depend on the `SeriesView` interface (types.ts), not on `SeriesStore` directly, so data and rendering evolve independently.
- **Single public surface**: `src/index.ts`. Everything else is implementation detail and may change without a major bump. When adding new API, re-export from `index.ts` or it's not public.
- **Two data modes on the same store**:
  - **Snapshot** (`setData`) — caller-owned arrays, `ownership: 'copy' | 'borrowed'`. `borrowed` shares references (fast, but arrays must be treated as immutable by the caller).
  - **Ring / streaming** — activated only when `maxPoints > 0` at construction (or later via `setMaxPoints`). O(1) `append` / `appendBatch` / `appendFrame`, O(1) sliding min/max via `MonotonicExtent`. `maxPoints: 0` (default) means snapshot.
- **Draw pipeline**:
  1. Static layer (grid + axes + all series) is drawn once to an **offscreen canvas**.
  2. `blit` copies offscreen → visible canvas 1:1 in device pixels.
  3. Crosshair is overlaid on top of the visible canvas. Cursor motion never repaints series.
- **Dirty flags**: `dirtyLayout` (data/domain change → full redraw) vs `dirtyPaint` (colours/fonts → repaint only). Coalesced via a single `requestAnimationFrame`. `draw()` returns early when clean.
- **Auto-draw**: OFF by default (`autoDraw: false`). Mutations mark dirty and schedule a rAF; you generally don't call `draw()` manually. Set `autoDraw: true` to skip rAF and paint synchronously.
- **Suspend/resume**: `suspendDraw()` / `resumeDraw()` are **nestable** (counter). `batch(fn)` is throw-safe and coalesces mutations to one repaint.
- **Dual-Y**: any `SeriesConfig.yAxis: 'right'` activates a separate right domain. Left and right domains are computed independently (union across their axis-assigned series). The crosshair reads each series' hit against its own axis.
- **Multi-series stacking**: series sharing the same `stackGroup` key are accumulated. Stack-group detection is cached in the constructor (`stackGroupsAll`, `stackGroupsByAxis`); rebuilt only on structural mutation. Misalignment warnings dedupe via `stackWarned` (once per group, not per frame).
- **Viewport (v1.7.0)**: `setViewport({ xMin, xMax, yAuto? })` is the highest-priority X-domain source — `updateGridDomain` short-circuits on it before touching streaming / `fixedY` / `gridPinned` logic (that entry check is **non-negotiable**; do not fold it into the nested `if`s below). When active, Y is auto-scaled to samples inside the visible window (via `computeWindowedYExtent`) unless `yAuto: false`. Any streaming mutation (`append`, `appendFrame`, `setData`, `setMaxPoints`, `clear`) calls `reclampViewportToExtent()` so a sliding ring never leaves the viewport stranded outside the data.
- **Interaction pipeline (v1.7.0)**: `onWheel` / `onPointerMove` / `onPointerDown` / `onPointerUp` mutate state (viewport, cursor, `dragging`, `pinching`) **synchronously** — programmatic reads like `getViewport()` always reflect the latest event — but the repaint is coalesced into `interactionRafId` (separate from the autoDraw `rafScheduled`). Wheel `deltaY` is normalised across `deltaMode` (line ×16, page ×400), clamped ±500 per event, and composed exponentially (`exp(delta / 500)`) so mouse coarse ticks and touchpad high-frequency swipes feel the same. Pinch: while exactly two `activePointers` are tracked, `updatePinchState` computes zoom (dist ratio, centroid anchor, clamped [0.5, 2] per frame) + pan (centroid delta), and pinch→pan handoff is automatic when one finger lifts.
- **Windowed rendering (v1.7.0)**: `math/window.ts:resolveRenderWindow(view, xMin, xMax)` binary-searches `view.bracketLogical` (+1 sample of context on each side for entry/exit segments) so `renderLine` / `renderArea` / `renderScatter` / `renderStackedBands` iterate only `[iStart, iEnd]` instead of `[0, count)`. Under a narrow viewport this drops per-frame work from O(n_total) to O(n_visible). The extra ±1 sample keeps polyline entry/exit segments continuous into the plot edge.
- **Series clipping (v1.7.0)**: `renderStatic` wraps series + legend rendering in `ctx.save() / ctx.rect(plot) / ctx.clip() / ctx.restore()`. Grid and axes are drawn **outside** the clip so tick labels in the padding area still show. Without this, a narrow viewport projects off-screen samples to pixel coordinates far outside the plot rect and the Canvas 2D API happily paints them over the axis labels — do not remove the clip.
- **Pool of views (v1.7.0)**: `PooledView` (module-local class in `chart-base.ts`) implements `SeriesView` with plain fields plus `physOf`/`bracketLogical` delegating to a bound store. `ChartBase` keeps `viewSlotRender` (1 slot for `renderOne` — the view is consumed before the next series binds it) and `viewPoolCrosshair: PooledView[]` (one slot per series, all live simultaneously during `computeHits` + `renderCrosshair`). Two pools because the two call sites have different lifetimes. Never allocate a fresh view object in the render/crosshair hot path — bind an existing slot instead.

## Public API cheatsheet (`ChartBase`)

All three chart classes are `new LineChart(canvas, opts?)` / `new AreaChart(...)` / `new ScatterChart(...)`. They share this API from `ChartBase`:

- **Data**: `setData(ref, x, y, ownership?)`, `append(ref, x, y)`, `appendBatch(ref, xs, ys)`, `appendFrame(x, values)` (atomic multi-series, emits `frameappended`), `setMaxPoints(n)`, `clear()`.
- **Series**: `addSeries(cfg): number`, `removeSeries(ref)`, `showSeries(ref)`, `hideSeries(ref)`, `setOptions(patch)`.
- **Queries**: `seriesCount`, `windowPointCount`, `drawnPointCount`, `pointCount(ref)`, `extentMin(ref)` / `extentMax(ref)`, `lastValue(ref)`.
- **Lifecycle**: `draw()`, `suspendDraw()` / `resumeDraw()`, `batch(fn)`, `toImage()`, `destroy()` (idempotent, emits `destroy` first).
- **Events**: `on(type, listener)` / `off(type, listener)`. Types: `frameappended` `{ seriesUpdated, render }`, `viewportchange` `{ xMin, xMax }`, `destroy` `{}`.
- **Viewport (v1.7.0)**: `setViewport({ xMin, xMax, yAuto? })`, `getViewport(): Viewport | null`, `resetViewport()`. When non-null, viewport wins over streaming / `fixedY` / `gridPinned` domains. `yAuto` defaults to `true` (Y rescales to visible samples); pass `false` to keep Y anchored to full-data extent. `yAuto` is preserved across programmatic and gesture-driven viewport changes.
- **Interaction (v1.7.0, wired automatically)**: wheel zoom (anchored to cursor, normalised across `deltaMode`), pointer/touch drag pan (single pointer inside plot rect), two-finger pinch zoom + pan (touch), arrow-key crosshair navigation, `Escape` to hide crosshair. All state changes are synchronous; repaint is rAF-coalesced. `canvas.style.touchAction = 'none'` is set automatically to reserve gestures for the chart without blocking scroll on the rest of the page.
- **Sync**: `sync(other)` / `unsync(other)` — bidirectional cross-chart **crosshair** sharing only (no domain/viewport sync).
- **`SeriesRef`**: pass either a numeric index or the `SeriesConfig.id` string; every data/metric method accepts both.

## Conventions

- **TypeScript strict-ish**: `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`. Use `import type { … }` for type-only imports (required by `verbatimModuleSyntax`).
- **`.ts` extensions in relative imports are mandatory** (`allowImportingTsExtensions: true`). Write `from './foo.ts'`, not `./foo` or `./foo.js`. The build rewrites `.ts` → `.js` in emitted `.d.ts` via `scripts/fix-dts-imports.mjs`.
- **File header convention**: every source file opens with a `/** @file … */` block explaining its role and the invariants it maintains. Match this when adding new files.
- **Prettier**: single quotes, semis, trailing commas `all`, `printWidth: 120`, `endOfLine: crlf`. `*.json` overrides to `printWidth: 80`. Run `npm run fix:all` before committing style-sensitive changes.
- **Renderers are pure**: functions in `render/` take `(ctx, view, plot, opts)` and never own state or schedule. Keep it that way. Scheduling and interaction live in `ChartBase`.
- **Hot loops inline arithmetic**: `renderLine` deliberately inlines scale math and uses a `toWrap` countdown instead of modulo. Don't refactor these to use `xToPx` / `yToPx` — those helpers exist for the cold path (ticks, crosshair) only.
- **Zero runtime dependencies** (`devDependencies` only). Don't add runtime deps without checking `docs/vision.md`.
- **Naming**: PascalCase classes (`ChartBase`, `SeriesStore`, `RingBuffer`), camelCase methods/variables, UPPER_SNAKE for constants (`CHART_DEFAULTS`, `STRUCTURAL_OPTION_KEYS`). Files are kebab-case (`chart-base.ts`, `series-store.ts`).
- **Comments/JSDoc are heavily used to document invariants and rationale**. Match the existing tone; don't strip explanatory comments.

## Testing

- **Vitest + happy-dom** (`vitest.config.ts`). Test files live under `src/**/__tests__/*.test.ts` (mirrors source dir).
- **`src/__setup.ts`** monkey-patches `HTMLCanvasElement.prototype.getContext('2d')` with a stateful stub because happy-dom doesn't implement it. New tests get this stub for free via `setupFiles`.
- **`src/render/__tests__/ctx-mock.ts`** provides a richer mock context that records calls (`beginPath`, `moveTo`, `lineTo`, `arc`, `fillText`, …). Use this in `render/` tests to assert draw commands, not pixel output.
- **Coverage thresholds** (v8): `statements 70 / branches 55 / functions 75 / lines 70`. Branches are lower on purpose because `chart-base.ts` holds DOM interaction paths hard to drive under happy-dom.
- README examples are typechecked in CI via `check:readme` — a broken example fails the pipeline just like a broken test.

## Gotchas

- **`endOfLine: crlf`** in `.prettierrc`. Working on Linux/macOS? Configure git `core.autocrlf` accordingly or Prettier will churn every file.
- **`.ts` import extensions**: TS 6.0 with `rewriteRelativeImportExtensions` still emits `.ts` in `.d.ts`. `scripts/fix-dts-imports.mjs` post-processes `dist/`. If you skip the full `npm run build` (e.g. running `tsc` directly), consumers on `node16` / `nodenext` resolution break with TS2834.
- **`ownership: 'borrowed'`** shares array references — the caller must not mutate them after `setData`. Default is `'copy'`. Getting this wrong causes silent corruption, not an error.
- **`maxPoints: 0` is a sentinel**, not "unlimited" — it means snapshot mode. Positive number = ring mode.
- **Structural vs paint-only `setOptions`**: keys `series | padding | yMin | yMax | maxPoints` (see `STRUCTURAL_OPTION_KEYS`) trigger `rebuildSeriesDerived()` + `invalidate('layout')` and **clear** any pinned grid domain; everything else is `invalidate('paint')`. Passing `series` always counts as structural even if identical.
- **`gapMode`** controls how `NaN` Y samples render: `'break'` (default, lifts pen), `'connect'` (skip and join neighbours), `'zero'` (treat as 0 for that draw). Chart-wide default at `ChartOpts.gapMode`; per-series override at `SeriesConfig.gapMode` (per-series wins).
- **`xAxis.type: 'time'`** treats X as epoch-ms. Coordinate math is unchanged (epoch-ms is linear); time-awareness is entirely in tick generation (`generateTimeTicks`) and label formatting (`formatTimeTick`). `formatTimeTick` forces `hourCycle: 'h23'` — do not remove that (it fixes non-determinism across host locales like `en-US`).
- **`xAxis.type: 'band'`** is reserved for v1.9.0 — `xToPx` throws a descriptive error if used. The type is accepted for forward-compatibility.
- **Viewport wins**: once `setViewport(…)` is called with a non-null range, it overrides streaming / fixedY / grid-pinned domains until `resetViewport()`. Streaming appends do NOT clear the viewport — they call `reclampViewportToExtent()` (shift-clamp preserving width, or auto-reset if the window is now wider than the extent). The viewport short-circuit at the entry of `updateGridDomain` is **non-negotiable**: never fold it into the nested `if`s below or the streaming/`fixedY`/pinned regimes will silently override it.
- **`yAuto` defaults to true.** A caller upgrading from v1.6.x that already used `setViewport({ xMin, xMax })` will suddenly see Y auto-scale to the visible window — visually different but semantically what "zoom" is supposed to do. Pass `yAuto: false` explicitly to preserve v1.6 behaviour.
- **Wheel zoom is not per-tick anymore**: `factor = Math.exp(delta / 500)` with `delta` normalised by `deltaMode` and clamped ±500. One wheel click gives ~22 % zoom, not 10 %. Any test that depends on the exact factor per event must account for this (existing tests only check _direction_ + monotonicity, which still hold).
- **Interaction repaint is rAF-coalesced**, not synchronous. State (`viewport`, `cursor`, `dragging`, `pinching`) mutates immediately in the handler — `getViewport()` reflects the wheel/pan/pinch on the next line — but the actual pixel update happens on the next animation frame. Tests that dispatch a wheel/pointer event and then read `getViewport()` work, but tests that expect the pixel to have changed must trigger a `chart.draw()` or await a rAF.
- **Pinch → drag handoff.** When two pointers are active, `pinching = true` and drag pan is suppressed. When one lifts, the remaining pointer becomes the new pan anchor (`dragging = true`, `dragLastPx` = remaining pointer's X). Don't rely on `pointerup` clearing `dragging` unconditionally — check `activePointers.size`.
- **`Surface.clientRect()` is cached**; `handleWindowLayoutShift` invalidates on window `scroll` (with `capture: true`, catches ancestor scroll) and `resize`. Any new code path that reads canvas position for a pointer/wheel event should use `surface.clientRect()`, not `canvas.getBoundingClientRect()`, or it will force reflow on every event.
- **Series clip in `renderStatic`.** The `ctx.save() / clip(plot) / restore()` around series + legend rendering is what prevents zoomed-out samples from projecting onto axis labels and canvas corners. Don't render series or legend outside the clip; don't clip grid/axes (labels live in the padding area).
- **`sync` shares crosshair only**, not domains or viewports. Don't extend it to more state without design discussion.
- **`destroy()` is idempotent** — emits `destroy` **before** teardown so listeners can still read state. After `destroy()`, all methods no-op safely.
- **Never edit `docs/vision.md`, `docs/improvements.md`, or `docs/addons.md`** as part of unrelated work — they are the source-of-truth product direction docs referenced by `docs/phases/`. The `phases/` files summarise them; changes to direction belong in the source docs first.
- **Roadmap**: `docs/phases/README.md` tracks minor-version phases (v1.1.0 … v1.9.0). Current shipped version is in `package.json` and `CHANGELOG.md`. Behaviour changes ship as **minor** with a `behavior fix` note, not major, until the DoD gate for `2.0.0`.
- **Do not commit to remote** and **do not push** unless explicitly asked. The repo uses signed CI and a release workflow (`.github/workflows/release.yml`) — don't run releases manually.
