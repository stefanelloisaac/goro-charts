# Goro Charts

Minimal high-performance chart engine. **Canvas 2D only. Zero runtime dependencies. Framework-agnostic.** Inspired by [uPlot](https://github.com/leeoniya/uPlot) — small, fast, and covers only what you need.

- **LineChart** — batched polyline with per-pixel-column min/max decimation
- **AreaChart** — filled region below the line with the same decimation path
- **ScatterChart** — stride-thinned scatter plot, one circle per sampled point
- **Multi-series** — one chart, many series, each with its own colour, width, fill, dash, and Y-axis
- **Dual Y-axis** — left and right domains, independent scales per series
- **Fixed Y range** — lock the grid with `yMin`/`yMax` (ideal for 0–100 % dashboards)
- Columnar `Float64Array` data per series (no object-per-point overhead)
- Streaming ring mode with O(1) append and O(1) sliding-window min/max via monotonic deques
- Dashed, boxed grid with a locked domain that expands but never shrinks — a real visual anchor
- `devicePixelRatio`-aware for sharp retina rendering
- Offscreen static layer — crosshair repaint is instant
- Built-in legend and multi-series crosshair with an interpolated tooltip card
- `ResizeObserver` auto-sizing, `rAF`-coalesced auto-draw

```bash
npm install goro-charts
```

---

## Quick start

```ts
import { LineChart } from 'goro-charts';

const canvas = document.querySelector('canvas') as HTMLCanvasElement;

const chart = new LineChart(canvas, {
  series: [
    { name: 'CPU', color: '#4ea8ff' },
    { name: 'Temp', color: '#ffb454', lineWidth: 1.2 },
  ],
  maxPoints: 2000,
  autoDraw: true,
});

chart.append(0, 0, 52); // CPU  @ x=0
chart.append(1, 0, 38); // Temp @ x=0

chart.appendBatch(0, [1, 2, 3], [55, 58, 57]);
chart.appendBatch(1, [1, 2, 3], [39, 40, 39]);
```

---

## Series model

Every chart holds one or more series. Each series owns its visual identity:

```ts
import type { SeriesConfig } from 'goro-charts';

interface SeriesConfig {
  /** Display name for the legend and crosshair tooltip. */
  name: string;
  /** Line stroke, crosshair dot, and legend swatch colour. */
  color: string;
  /** Line stroke width (AreaChart: top stroke width). Falls back to ChartOpts.lineWidth. */
  lineWidth?: number;
  /** Area fill colour (meaningful only on AreaChart). */
  fillColor?: string;
  /** Area fill opacity 0–1 (meaningful only on AreaChart). */
  fillOpacity?: number;
}
```

When `series` is omitted from `ChartOpts` a single default series is created automatically.

---

## Chart types

### `LineChart`

```ts
new LineChart(canvas, opts?: ChartOpts)
```

Each series is drawn as a single batched polyline. When the dataset is dense (more than 2× the plot width in samples) the renderer auto-switches to per-pixel-column min/max decimation — the visual envelope of the signal — so 500k points render as ~2×width segments with no aliasing. Multiple series are drawn in config order, each with its own colour.

### `AreaChart`

```ts
new AreaChart(canvas, opts?: ChartOpts)
```

Each series is drawn as a filled region below the line plus a top stroke. The area fill and the stroke are separate paths; only the visible top line is stroked (the bottom and side closure edges are never painted). `fillColor` and `fillOpacity` are per-series. Set `fillOpacity: 0` on a series to render it as a plain line overlay inside an area chart.

```ts
const chart = new AreaChart(canvas, {
  series: [
    { name: 'Req/s', color: '#52d4a0', fillColor: '#52d4a0', fillOpacity: 0.08 },
    { name: 'Baseline', color: '#c792ff', lineWidth: 1, fillOpacity: 0 },
  ],
  maxPoints: 2000,
  autoDraw: true,
});
```

---

### `ScatterChart`

```ts
new ScatterChart(canvas, opts?: ChartOpts)
```

Each series is drawn as filled circles, one per sampled point. When the dataset exceeds `maxDots` (default 2000) the renderer switches to **stride thinning** — it draws every `floor(n / maxDots)`-th point so the chart stays responsive at any data volume. Individual series can be dashed via `SeriesConfig.dash`.

```ts
const chart = new ScatterChart(canvas, {
  series: [
    { name: 'Packets', color: '#f07167', pointRadius: 3.5 },
    { name: 'Errors', color: '#ffb454', dash: [6, 3] },
  ],
  maxPoints: 5000,
  autoDraw: true,
});
```

---

## Data API

Every data method takes a **series index** as the first argument. `setMaxPoints()`, `clear()`, and `draw()` operate on all series.

| Method         | Signature                                                     | Description                                                        |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `setData`      | `(seriesIndex, x: Float64Array, y: Float64Array)`             | Snapshot: replace a series. O(n) extent.                           |
| `append`       | `(seriesIndex, x: number, y: number)`                         | Ring: append one point. O(1) amortized.                            |
| `appendBatch`  | `(seriesIndex, xs: ArrayLike<number>, ys: ArrayLike<number>)` | Ring: append a batch. O(k).                                        |
| `setMaxPoints` | `(maxPoints: number)`                                         | Resize the streaming window for all series.                        |
| `clear`        | `()`                                                          | Empty all series and reset the grid domain.                        |
| `draw`         | `()`                                                          | Manual paint. No-op when clean and no crosshair.                   |
| `suspendDraw`  | `()`                                                          | Pause rAF-coalesced drawing. Nestable — pair with `resumeDraw()`.  |
| `resumeDraw`   | `()`                                                          | Resume after matching `suspendDraw()`. Draws immediately if dirty. |
| `toImage`      | `()`                                                          | Export the canvas as a PNG data URL.                               |
| `destroy`      | `()`                                                          | Detach observers, release buffers.                                 |

### Read-only properties

| Property            | Type     | Description                        |
| ------------------- | -------- | ---------------------------------- |
| `seriesCount`       | `number` | Number of configured series        |
| `pointCount(index)` | `number` | Samples in the window for a series |
| `lastValue(index)`  | `number` | Most recent y (NaN if empty)       |
| `extentMin(index)`  | `number` | Window y minimum (O(1))            |
| `extentMax(index)`  | `number` | Window y maximum (O(1))            |

---

## Snapshot mode

Replace entire series at once. Can be mixed with ring mode on different series.

```ts
const x = new Float64Array([0, 1, 2, 3, 4]);
const cpu = new Float64Array([50, 53, 55, 52, 51]);
const temp = new Float64Array([36, 37, 38, 37, 36]);

chart.setData(0, x, cpu);
chart.setData(1, x, temp);
chart.draw();
```

---

## Streaming mode

Requires `maxPoints` at construction. Each series gets its own ring buffer. `setMaxPoints()` resizes all windows atomically. `autoDraw` coalesces rapid appends into a single `requestAnimationFrame` paint.

```ts
const chart = new LineChart(canvas, {
  series: [{ name: 'CPU', color: '#4ea8ff' }],
  maxPoints: 2000,
  autoDraw: true,
});

let t = 0;
setInterval(() => {
  chart.append(0, t, Math.random() * 100);
  t++;
}, 1000);
```

---

## Options

### `ChartOpts` (constructor)

| Option           | Default                                    | Description                                            |
| ---------------- | ------------------------------------------ | ------------------------------------------------------ |
| `series`         | `[{ name: 'Series 0', color: '#4ea8ff' }]` | Array of per-series visual configs                     |
| `padding`        | `[16, 16, 32, 56]`                         | `[top, right, bottom, left]` in CSS pixels             |
| `gridColor`      | `rgba(255,255,255,0.08)`                   | Dashed internal grid line colour                       |
| `axisColor`      | `rgba(255,255,255,0.25)`                   | Grid frame stroke colour                               |
| `textColor`      | `rgba(255,255,255,0.5)`                    | Tick labels, legend text, tooltip labels               |
| `fontSize`       | `11`                                       | Base font size for all text                            |
| `fontFamily`     | `system-ui, …`                             | Font stack for all text                                |
| `bgColor`        | `'#111'`                                   | Canvas background fill                                 |
| `crosshairColor` | `rgba(255,255,255,0.3)`                    | Crosshair guide line colour                            |
| `crosshairWidth` | `1`                                        | Crosshair guide line width                             |
| `pointRadius`    | `4`                                        | Crosshair marker dot radius                            |
| `xTicks`         | `8`                                        | Approximate X-axis tick count                          |
| `yTicks`         | `6`                                        | Approximate Y-axis tick count                          |
| `maxPoints`      | `0`                                        | Activate ring streaming mode (0 = off)                 |
| `autoDraw`       | `false`                                    | Coalesce data changes into one rAF draw                |
| `yMin`           | `0`                                        | Fixed Y-axis lower bound (0 = auto). Pair with `yMax`. |
| `yMax`           | `0`                                        | Fixed Y-axis upper bound (0 = auto). Pair with `yMin`. |
| `maxDots`        | `2000`                                     | Max dots before scatter chart stride-thinning kicks in |
| `lineColor`      | `#4ea8ff`                                  | Fallback line colour                                   |
| `lineWidth`      | `1.5`                                      | Fallback line width                                    |
| `fillColor`      | `#4ea8ff`                                  | Fallback area fill                                     |
| `fillOpacity`    | `0.15`                                     | Fallback area fill opacity                             |
| `pointColor`     | `#4ea8ff`                                  | Fallback crosshair dot colour                          |

### `SeriesConfig` (per series)

| Field         | Required | Default                 | Description                                              |
| ------------- | -------- | ----------------------- | -------------------------------------------------------- |
| `name`        | yes      | —                       | Legend and tooltip label                                 |
| `color`       | yes      | —                       | Line, dot, and legend swatch colour                      |
| `lineWidth`   | no       | `ChartOpts.lineWidth`   | Stroke width                                             |
| `dash`        | no       | —                       | Dash pattern, e.g. `[8, 4]` for dashed lines             |
| `fillColor`   | no       | `ChartOpts.fillColor`   | Area fill colour                                         |
| `fillOpacity` | no       | `ChartOpts.fillOpacity` | Area fill opacity                                        |
| `yAxis`       | no       | `'left'`                | Which Y axis this series maps to (`'left'` \| `'right'`) |

---

## Grid & axes

The grid is intentionally stable — it does not recompute a tight Y range on every append. Instead the grid domain locks to the data extent on the first draw and only expands when the data exceeds it (with a 10 % margin). The grid **never shrinks**, keeping horizontal reference lines stationary so the eye tracks movement inside a stable frame.

The grid itself is a dashed internal lattice plus a closed rectangular frame drawn via `strokeRect`. The frame replaces old-style axis strokes — tick labels sit outside the frame with no extra axis lines.

---

## Crosshair

- A dashed vertical guide line is always drawn.
- A dashed horizontal guide appears only when exactly one series is visible.
- Marker dots sit at each series' interpolated position with a dark halo for readability over filled areas.
- Y values are linearly interpolated between the two samples bracketing the cursor — the readout slides smoothly, never jumping by whole samples.

The tooltip is a rounded card:

```
┌──────────────────────────┐
│ x                    42.6│   header row
│ ──────────────────────── │   divider
│ ● CPU              67.5% │   series dot + name + value
│ ● Temp             48.2° │
└──────────────────────────┘
```

---

## Legend

Rendered automatically when two or more series are configured. Placed in the top-right corner of the plot. Laid out horizontally in a rounded pill; falls back to a vertical stack if the row would overflow the plot width.

---

## Dual Y-axis

When a series declares `yAxis: 'right'` the chart maintains a separate Y domain for it, with tick labels rendered on the right side of the frame. Each series uses its own domain for scale mapping; the crosshair reads the correct axis per series.

```ts
const chart = new LineChart(canvas, {
  series: [
    { name: 'Temp (°C)', color: '#ffb454', yAxis: 'left' },
    { name: 'Humidity (%)', color: '#4ea8ff', yAxis: 'right' },
  ],
  maxPoints: 2000,
  autoDraw: true,
});
```

---

## Presets

Pre-built `DARK` and `LIGHT` colour presets ready to spread over constructor options.

```ts
import { LineChart, DARK, LIGHT } from 'goro-charts'

// Dark (default) — explicit
new LineChart(canvas, { ...DARK, series: [...] })

// Light theme
new LineChart(canvas, { ...LIGHT, series: [...] })
```

---

## Bulk loading

`suspendDraw()` pauses the rAF-coalesced draw scheduler. Pair it with `resumeDraw()` to batch many append / setData calls without intermediate paints. Nestable — pause N times, resume N times.

```ts
chart.suspendDraw();
for (const batch of batches) {
  chart.appendBatch(0, batch.x, batch.y);
}
chart.resumeDraw(); // one draw, then normal scheduling resumes
```

---

## Fixed Y range

Set `yMin` and `yMax` to pin the grid domain to a known range. The grid won't auto-expand — ideal for dashboards where the scale is fixed (e.g. always 0–100 %).

```ts
new LineChart(canvas, {
  yMin: 0,
  yMax: 100,
  series: [{ name: 'CPU', color: '#4ea8ff' }],
});
```

When both are `0` (the default) the grid domain expands automatically from data.

---

## Architecture

```
src/
  index.ts               Public barrel
  types.ts               ChartOpts, SeriesConfig, PlotRect, Domain, SeriesView
  defaults.ts            Baseline options
  presets.ts             DARK / LIGHT colour presets

  charts/
    chart-base.ts        Abstract orchestrator (multi-store, locked grid, dirty/rAF, interaction)
    line-chart.ts        LineChart — delegates to renderLine
    area-chart.ts        AreaChart — delegates to renderArea
    scatter-chart.ts     ScatterChart — delegates to renderScatter

  data/
    monotonic-extent.ts  O(1) sliding min/max via dual monotonic deques
    ring-buffer.ts       O(1) append ring, no memmove
    series-store.ts      Unified snapshot + ring data store

  render/
    axes.ts              Dashed grid + tick labels, dual-Y support
    line.ts              Batched line with per-pixel decimation
    area.ts              Batched area fill + stroke (same decimation, separate paths)
    scatter.ts           Stride-thinned scatter plot
    crosshair.ts         Multi-series interpolated crosshair + tooltip card
    legend.ts            Horizontal compact legend pill
    shape.ts             Canvas path helper (roundedRect)
    surface.ts           DPR, offscreen buffer, 1:1 blit

  math/
    scale.ts             Data ↔ pixel transforms
    ticks.ts             Nice tick generation (1, 2, 5 × 10ⁿ)
    format.ts            Numeric label formatting
```

---

## License

MIT
