# Goro Charts

[![CI](https://github.com/stefanelloisaac/goro-charts/actions/workflows/ci.yml/badge.svg)](https://github.com/stefanelloisaac/goro-charts/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/goro-charts.svg)](https://www.npmjs.com/package/goro-charts)
[![bundle size](https://img.shields.io/bundlephobia/minzip/goro-charts)](https://bundlephobia.com/package/goro-charts)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**[Live demo →](https://stefanelloisaac.github.io/goro-charts/)**

<!-- TODO: gravar e adicionar docs/assets/streaming.gif, depois descomentar:
![Live streaming demo](docs/assets/streaming.gif)
-->

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
- `appendFrame` — atomically stream one sample per series with automatic carry-forward
- Typed events (`frameappended`, `viewportchange`, `destroy`) with add/remove listeners
- Wheel zoom, drag pan, and two-finger pinch out of the box (Pointer Events, touch-aware); auto-Y rescales to the visible window
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
    { id: 'cpu', name: 'CPU', color: '#4ea8ff' },
    { id: 'temp', name: 'Temp', color: '#ffb454', lineWidth: 1.2 },
  ],
  maxPoints: 2000,
  autoDraw: true,
});

chart.append('cpu', 0, 52); // CPU  @ x=0
chart.append('temp', 0, 38); // Temp @ x=0

chart.appendBatch('cpu', [1, 2, 3], [55, 58, 57]);
chart.appendBatch('temp', [1, 2, 3], [39, 40, 39]);
```

---

## Series model

Every chart holds one or more series. Each series owns its visual identity:

```ts
// signature
import type { SeriesConfig } from 'goro-charts';

interface SeriesConfig {
  /** Display name for the legend and crosshair tooltip. */
  name: string;
  /** Line stroke, crosshair dot, and legend swatch colour. */
  color: string;
  /** Line stroke width (AreaChart: top stroke width). Falls back to ChartOpts.lineWidth. */
  lineWidth?: number;
  /** Line dash pattern, e.g. [8, 4] for dashed lines. */
  dash?: number[];
  /** Area fill colour (meaningful only on AreaChart). */
  fillColor?: string;
  /** Area fill opacity 0–1 (meaningful only on AreaChart). */
  fillOpacity?: number;
  /** Which Y axis this series maps to. Default 'left'. */
  yAxis?: 'left' | 'right';
  /** Stack group id — series sharing one id render cumulatively (AreaChart). */
  stack?: string;
  /** Fixed Y lower bound for this series only (overrides the grid domain). */
  yMin?: number;
  /** Fixed Y upper bound for this series only (overrides the grid domain). */
  yMax?: number;
  /** Per-series override of the tooltip value formatter. Takes precedence over ChartOpts.tooltip.valueFormat. */
  valueFormat?: (value: number) => string;
  /** Per-series override of ChartOpts.gapMode. */
  gapMode?: 'break' | 'connect' | 'zero';
}
```

When `series` is omitted from `ChartOpts` a single default series is created automatically.

---

## Chart types

### `LineChart`

```ts
// signature
new LineChart(canvas, opts?: ChartOpts)
```

Each series is drawn as a single batched polyline. When the dataset is dense (more than 2× the plot width in samples) the renderer auto-switches to per-pixel-column min/max decimation — the visual envelope of the signal — so 500k points render as ~width vertical segments with no aliasing. Multiple series are drawn in config order, each with its own colour.

### `AreaChart`

```ts
// signature
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
// signature
new ScatterChart(canvas, opts?: ChartOpts)
```

Each series is drawn as filled circles, one per sampled point. When the dataset exceeds `maxDots` (default 2000) the renderer switches to **stride thinning** — it draws every `floor(n / maxDots)`-th point so the chart stays responsive at any data volume. Individual series can be dashed via `SeriesConfig.dash`.

```ts
const chart = new ScatterChart(canvas, {
  series: [
    { name: 'Packets', color: '#f07167' },
    { name: 'Errors', color: '#ffb454', dash: [6, 3] },
  ],
  pointRadius: 3.5,
  maxPoints: 5000,
  autoDraw: true,
});
```

---

## Data API

Every data method takes a **series index** as the first argument. `setMaxPoints()`, `clear()`, and `draw()` operate on all series.

| Method         | Signature                                                                           | Description                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setData`      | `(seriesIndex, x: Float64Array, y: Float64Array, ownership?: 'copy' \| 'borrowed')` | Snapshot: replace a series. O(n) extent. Ownership: `'copy'` (default, safe) copies arrays; `'borrowed'` keeps caller's reference (must be treated as immutable). |
| `append`       | `(seriesIndex, x: number, y: number)`                                               | Ring: append one point. O(1) amortized.                                                                                                                           |
| `appendBatch`  | `(seriesIndex, xs: ArrayLike<number>, ys: ArrayLike<number>)`                       | Ring: append a batch. O(k).                                                                                                                                       |
| `appendFrame`  | `(x: number, values: Map<SeriesRef, number> \| Record<string, number>)`             | Ring: atomically append one sample per series. Absent series receive carry-forward.                                                                               |
| `setMaxPoints` | `(maxPoints: number)`                                                               | Resize the streaming window for all series.                                                                                                                       |
| `clear`        | `()`                                                                                | Empty all series and reset the grid domain.                                                                                                                       |
| `draw`         | `()`                                                                                | Manual paint. No-op when clean and no crosshair.                                                                                                                  |
| `suspendDraw`  | `()`                                                                                | Pause rAF-coalesced drawing. Nestable — pair with `resumeDraw()`.                                                                                                 |
| `resumeDraw`   | `()`                                                                                | Resume after matching `suspendDraw()`. Draws immediately if dirty.                                                                                                |
| `toImage`      | `()`                                                                                | Export the canvas as a PNG data URL.                                                                                                                              |
| `destroy`      | `()`                                                                                | Detach observers, release buffers.                                                                                                                                |

### Ownership (`copy` vs `borrowed`)

`setData` accepts an optional fourth argument to control data ownership:

- **`'copy'`** (default) — the chart copies your arrays into fresh buffers. You may reuse or mutate the originals freely after the call. This is the safe default.
- **`'borrowed'`** — the chart keeps your arrays by reference to avoid allocation. The caller **must** treat the arrays as immutable for as long as the chart holds them; mutating them externally leads to undefined behaviour.

```ts
// Safe default — caller can mutate the originals later
chart.setData('cpu', x, y);

// Zero-copy — caller must not mutate x or y after this call
chart.setData('cpu', x, y, 'borrowed');
```

### Referencing series

Every data and metric method accepts a **`SeriesRef`** — either the 0-based
index or the series' `id`. Give a series a stable `id` and use it everywhere:

```ts
const chart = new LineChart(canvas, {
  series: [
    { id: 'cpu', name: 'CPU', color: '#4ea8ff' },
    { id: 'mem', name: 'Memory', color: '#52d4a0' },
  ],
  maxPoints: 2000,
  autoDraw: true,
});

chart.append('cpu', 0, 52);
chart.pointCount('mem'); // → number of samples in the 'mem' window
```

Duplicate ids are rejected at construction and by `addSeries`.

### Read-only properties

| Property          | Type     | Description                        |
| ----------------- | -------- | ---------------------------------- |
| `seriesCount`     | `number` | Number of configured series        |
| `pointCount(ref)` | `number` | Samples in the window for a series |
| `lastValue(ref)`  | `number` | Most recent y (NaN if empty)       |
| `extentMin(ref)`  | `number` | Window y minimum (O(1))            |
| `extentMax(ref)`  | `number` | Window y maximum (O(1))            |

### Series & options at runtime

| Method              | Description                                                     |
| ------------------- | --------------------------------------------------------------- |
| `setOptions(patch)` | Update options in place; visual keys repaint, structural reflow |
| `addSeries(config)` | Append a series at runtime; returns its index                   |
| `removeSeries(ref)` | Remove a series and reflow                                      |
| `showSeries(ref)`   | Un-hide a series                                                |
| `hideSeries(ref)`   | Exclude a series from render, domain, and crosshair             |
| `batch(fn)`         | Group mutations into a single frame                             |

```ts
// Recolour without recomputing the domain
chart.setOptions({ crosshairColor: '#ffffff' });

// Add, hide, and batch
const idx = chart.addSeries({ id: 'io', name: 'IO', color: '#f07167' });
chart.hideSeries('io');

chart.batch(() => {
  chart.append('cpu', 10, 40);
  chart.append('mem', 10, 55);
}); // one repaint
```

---

## Snapshot mode

Replace entire series at once. Can be mixed with ring mode on different series.

```ts
const x = new Float64Array([0, 1, 2, 3, 4]);
const cpu = new Float64Array([50, 53, 55, 52, 51]);
const temp = new Float64Array([36, 37, 38, 37, 36]);

chart.setData('cpu', x, cpu);
chart.setData('temp', x, temp);
chart.draw();
```

---

## Streaming mode

Requires `maxPoints` at construction. Each series gets its own ring buffer. `setMaxPoints()` resizes all windows atomically. `autoDraw` coalesces rapid appends into a single `requestAnimationFrame` paint.

```ts
const chart = new LineChart(canvas, {
  series: [{ id: 'cpu', name: 'CPU', color: '#4ea8ff' }],
  maxPoints: 2000,
  autoDraw: true,
});

let t = 0;
setInterval(() => {
  chart.append('cpu', t, Math.random() * 100);
  t++;
}, 1000);
```

### Atomic multi-series frames

When streaming multiple series, use `appendFrame` to keep every series aligned at a shared `x`. Series absent from the map receive a carry‑forward of their last value so the window stays synchronised frame‑by‑frame:

```ts
const chart = new LineChart(canvas, {
  series: [
    { id: 'cpu', name: 'CPU', color: '#4ea8ff' },
    { id: 'mem', name: 'Memory', color: '#52d4a0' },
    { id: 'net', name: 'Network', color: '#f07167' },
  ],
  maxPoints: 2000,
  autoDraw: true,
});

let t = 0;
setInterval(() => {
  chart.appendFrame(t, {
    cpu: Math.random() * 100,
    mem: Math.random() * 100,
    // 'net' absent → carrega forward o último y
  });
  t++;
}, 1000);
```

## Events

Register typed listeners for chart lifecycle and streaming events. Listeners are automatically cleaned up on `destroy()`.

```ts
chart.on('frameappended', (ev) => {
  console.log(`${ev.seriesUpdated} series updated, render=${ev.render}`);
});

chart.on('destroy', () => {
  console.log('chart destroyed');
});

// Remove a specific listener — on() returns the same listener you passed,
// so store it to call off() later.
const myHandler: ChartEventListener<'frameappended'> = (ev) => {
  console.log(`${ev.seriesUpdated} series updated, render=${ev.render}`);
};
chart.on('frameappended', myHandler);

chart.on('destroy', () => {
  console.log('chart destroyed');
});

chart.off('frameappended', myHandler);
```

| Event            | Payload                                      | When                                                                        |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `frameappended`  | `{ seriesUpdated: number; render: boolean }` | After every `appendFrame` call                                              |
| `viewportchange` | `{ xMin: number; xMax: number }`             | After `setViewport` / `resetViewport` / wheel / drag / pinch / auto-reclamp |
| `destroy`        | `{}`                                         | Once, just before listeners clear                                           |

---

## Options

### `ChartOpts` (constructor)

| Option           | Default                                    | Description                                                                                                  |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `series`         | `[{ name: 'Series 0', color: '#4ea8ff' }]` | Array of per-series visual configs                                                                           |
| `padding`        | `[16, 16, 32, 56]`                         | `[top, right, bottom, left]` in CSS pixels                                                                   |
| `gridColor`      | `rgba(255,255,255,0.08)`                   | Dashed internal grid line colour                                                                             |
| `axisColor`      | `rgba(255,255,255,0.25)`                   | Grid frame stroke colour                                                                                     |
| `textColor`      | `rgba(255,255,255,0.5)`                    | Tick labels, legend text, tooltip labels                                                                     |
| `fontSize`       | `11`                                       | Base font size for all text                                                                                  |
| `fontFamily`     | `system-ui, …`                             | Font stack for all text                                                                                      |
| `bgColor`        | `'#111'`                                   | Canvas background fill                                                                                       |
| `crosshairColor` | `rgba(255,255,255,0.3)`                    | Crosshair guide line colour                                                                                  |
| `crosshairWidth` | `1`                                        | Crosshair guide line width                                                                                   |
| `pointRadius`    | `4`                                        | Crosshair marker dot radius                                                                                  |
| `xTicks`         | `8`                                        | Approximate X-axis tick count                                                                                |
| `yTicks`         | `6`                                        | Approximate Y-axis tick count                                                                                |
| `maxPoints`      | `0`                                        | Activate ring streaming mode (0 = off)                                                                       |
| `autoDraw`       | `false`                                    | Coalesce data changes into one rAF draw                                                                      |
| `yMin`           | `0`                                        | Fixed Y-axis lower bound (0 = auto). Pair with `yMax`.                                                       |
| `yMax`           | `0`                                        | Fixed Y-axis upper bound (0 = auto). Pair with `yMin`.                                                       |
| `maxDots`        | `2000`                                     | Max dots before scatter chart stride-thinning kicks in                                                       |
| `lineColor`      | `#4ea8ff`                                  | Fallback line colour                                                                                         |
| `lineWidth`      | `1.5`                                      | Fallback line width                                                                                          |
| `fillColor`      | `#4ea8ff`                                  | Fallback area fill                                                                                           |
| `fillOpacity`    | `0.15`                                     | Fallback area fill opacity                                                                                   |
| `pointColor`     | `#4ea8ff`                                  | Fallback crosshair dot colour                                                                                |
| `xAxis`          | `{ type: 'linear' }`                       | X-axis scale type, tick formatter, and time zone — see [Time axis and formatters](#time-axis-and-formatters) |
| `yAxis`          | `{}`                                       | Y-axis tick formatter (shared by both left and right axes)                                                   |
| `tooltip`        | `{}`                                       | Crosshair tooltip value/X formatter                                                                          |
| `gapMode`        | `'break'`                                  | Chart-wide default for how a series renders `NaN` samples — see [Missing data (gaps)](#missing-data-gaps)    |

### `SeriesConfig` (per series)

| Field         | Required | Default                 | Description                                                                            |
| ------------- | -------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `name`        | yes      | —                       | Legend and tooltip label                                                               |
| `color`       | yes      | —                       | Line, dot, and legend swatch colour                                                    |
| `lineWidth`   | no       | `ChartOpts.lineWidth`   | Stroke width                                                                           |
| `dash`        | no       | —                       | Dash pattern, e.g. `[8, 4]` for dashed lines                                           |
| `fillColor`   | no       | `ChartOpts.fillColor`   | Area fill colour                                                                       |
| `fillOpacity` | no       | `ChartOpts.fillOpacity` | Area fill opacity                                                                      |
| `yAxis`       | no       | `'left'`                | Which Y axis this series maps to (`'left'` \| `'right'`)                               |
| `valueFormat` | no       | —                       | Per-series tooltip value formatter (overrides `ChartOpts.tooltip.valueFormat`)         |
| `gapMode`     | no       | `ChartOpts.gapMode`     | Per-series override of how `NaN` samples render (`'break'` \| `'connect'` \| `'zero'`) |

---

## Grid & axes

The grid is intentionally stable — it does not recompute a tight Y range on every append. Instead the grid domain locks to the data extent on the first draw and only expands when the data exceeds it (with a 10 % margin). The grid **never shrinks**, keeping horizontal reference lines stationary so the eye tracks movement inside a stable frame.

The grid itself is a dashed internal lattice plus a closed rectangular frame drawn via `strokeRect`. The frame replaces old-style axis strokes — tick labels sit outside the frame with no extra axis lines.

---

## Time axis and formatters

By default the X axis treats values as plain numbers (`xAxis.type: 'linear'`, the default). Set `type: 'time'` to treat X values as epoch milliseconds — ticks then snap to calendar-sensible steps (second → minute → hour → day/week → month/quarter → year) instead of arbitrary linear divisions, and labels default to a granularity-matched date/time format.

> `'band'` is also a valid `ScaleType` value (reserved for the future bar chart). It is recognised by the public type now so consumers can reference it without a breaking change later, but using it at runtime throws until the implementation lands.

```ts
const chart = new LineChart(canvas, {
  xAxis: {
    type: 'time',
    // Only affects the built-in default formatter — has no effect when
    // tickFormat is supplied; the library does not implement general time
    // zone conversion.
    timeZone: 'America/Sao_Paulo',
  },
});
```

Every axis and the tooltip accept a custom formatter. Formatters are presentation-only — they never mutate the stored numeric value:

```ts
const chart = new LineChart(canvas, {
  xAxis: {
    type: 'time',
    tickFormat: (ms) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(ms),
  },
  yAxis: {
    tickFormat: (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value),
  },
  tooltip: {
    xFormat: (ms) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(ms),
    valueFormat: ({ value, series }) => `${series.name}: ${value.toFixed(1)}`,
  },
  series: [{ name: 'Price', color: '#4ea8ff', valueFormat: (value) => `$${value.toFixed(2)}` }],
});
```

Formatter precedence for the tooltip value: `SeriesConfig.valueFormat` → `ChartOpts.tooltip.valueFormat` → the built-in default. Axis tick labels follow `xAxis.tickFormat` / `yAxis.tickFormat` → the built-in default (time-aware when `xAxis.type: 'time'`, plain number formatting otherwise).

---

## Missing data (gaps)

Use `NaN` in a series' Y array to represent a missing sample. `NaN` never participates in the grid domain, stacking, or the crosshair tooltip regardless of `gapMode` — only how the _gap itself_ renders is controlled by `gapMode`:

```ts
type GapMode = 'break' | 'connect' | 'zero';
```

- `'break'` (default): lifts the pen — no line or fill crosses the gap.
- `'connect'`: skips the missing sample so its valid neighbours join directly.
- `'zero'`: treats the missing sample as `0` for rendering only; the stored data is never mutated.

`gapMode` can be set chart-wide (`ChartOpts.gapMode`) or per series (`SeriesConfig.gapMode`, which takes precedence):

```ts
const chart = new LineChart(canvas, {
  gapMode: 'break',
  series: [
    { name: 'Sensor A', color: '#4ea8ff' }, // uses the chart-wide 'break'
    { name: 'Sensor B', color: '#52d4a0', gapMode: 'connect' },
  ],
});

const y = new Float64Array([10, 12, Number.NaN, Number.NaN, 17]) as unknown as Float64Array<ArrayBufferLike>;
```

Stacked series (`AreaChart` with a shared `stack` id): a `NaN` sample in one layer contributes `0` to that layer's cumulative sum at that index instead of poisoning every later cumulative value.

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
    { id: 'temp', name: 'Temp (°C)', color: '#ffb454', yAxis: 'left' },
    { id: 'humidity', name: 'Humidity (%)', color: '#4ea8ff', yAxis: 'right' },
  ],
  maxPoints: 2000,
  autoDraw: true,
});
```

---

## Stacked area

Series that share the same `stack` id render cumulatively: each layer's Y
values are added on top of the previous layer's accumulated Y within the
group, so the bands sit flush against each other. Meaningful only on an
`AreaChart`. The crosshair dots follow the accumulated band edges.

```ts
const chart = new AreaChart(canvas, {
  series: [
    { id: 'sys', name: 'System', color: '#4ea8ff', stack: 'cpu' },
    { id: 'user', name: 'User', color: '#52d4a0', stack: 'cpu' },
    { id: 'io', name: 'IO Wait', color: '#ffb454', stack: 'cpu' },
  ],
  maxPoints: 2000,
  autoDraw: true,
});
```

A `stack` group with fewer than two populated series falls back to a normal
(non-stacked) area render.

Like `LineChart` / `AreaChart`, stacked bands auto-switch to per-pixel-column
min/max decimation once a layer is denser than 2× the plot width, so large
windows (tens of thousands of points per series) stay cheap — the cost is
bounded by the visible vertex count (~2× the plot width) rather than the total
data size.

---

## Presets

Pre-built `DARK` and `LIGHT` colour presets ready to spread over constructor options.

```ts
import { LineChart, DARK, LIGHT } from 'goro-charts';

// Dark (default) — explicit
new LineChart(canvas, { ...DARK, series: [/* ... */] });

// Light theme
new LineChart(canvas, { ...LIGHT, series: [/* ... */] });
```

---

## Bulk loading

`batch(fn)` groups many append / setData calls into a single repaint — drawing is suspended for the callback and resumed afterwards (even if it throws).

```ts
chart.batch(() => {
  for (const b of batches) {
    chart.appendBatch('cpu', b.x, b.y);
  }
}); // one draw, then normal scheduling resumes
```

For manual control, `suspendDraw()` / `resumeDraw()` are also available (nestable — pause N times, resume N times).

---

## Fixed Y range

Set `yMin` and `yMax` to pin the grid domain to a known range. The grid won't auto-expand — ideal for dashboards where the scale is fixed (e.g. always 0–100 %).

```ts
new LineChart(canvas, {
  yMin: 0,
  yMax: 100,
  series: [{ id: 'cpu', name: 'CPU', color: '#4ea8ff' }],
});
```

When both are `0` (the default) the grid domain expands automatically from data.

---

## Viewport, zoom, pan

Interact with the chart directly (mouse, touchpad, touch) or drive the visible
X window programmatically. Both paths funnel through the same viewport: whichever
was set most recently wins, and every change emits `viewportchange`.

### Built-in gestures

- **Wheel zoom.** Rolling the mouse wheel over the plot zooms in/out anchored at
  the cursor. `deltaY` is normalised across `deltaMode` (line / page / pixel) and
  clamped per event, so a coarse mouse wheel and a high-precision touchpad both
  feel natural.
- **Drag pan.** `pointerdown` inside the plot followed by `pointermove` shifts
  the window. Pan respects the data extent — dragging past the edge locks the
  edge in place and preserves the window width.
- **Pinch zoom + pan (touch).** Two fingers on the canvas: distance drives zoom
  (anchored at the centroid), centroid movement drives pan. Lift one finger and
  the gesture hands off to single-finger pan automatically.
- **Keyboard.** `ArrowLeft` / `ArrowRight` step the crosshair one sample
  (`Shift` = 10); `Escape` hides it. The canvas is focusable (`tabIndex: 0`).

`canvas.style.touchAction = 'none'` is set automatically so gestures reach the
chart without blocking scroll on the rest of the page.

### Programmatic viewport

```ts
// Zoom into a specific X range
chart.setViewport({ xMin: 100, xMax: 200 });

// Same, but keep Y anchored to the full-data extent
chart.setViewport({ xMin: 100, xMax: 200, yAuto: false });

// Read the current window (null when no viewport is set)
const vp = chart.getViewport();

// Clear and return to the auto/streaming domain
chart.resetViewport();

// React to any viewport change (gesture-driven or programmatic)
chart.on('viewportchange', ({ xMin, xMax }) => {
  console.log(`viewport = [${xMin}, ${xMax}]`);
});
```

`Viewport.yAuto` (default `true`) rescales Y to the samples inside the visible X
window — zooming into a small feature makes it fill the plot vertically instead
of staying flat against the global peak. `ChartOpts.yMin`/`yMax` still win over
auto-Y. Under streaming mode, `append` / `appendFrame` / `setMaxPoints` /
`clear` automatically shift-clamp the viewport when the ring slides so the
window never strays outside the data.

---

## Chart sync

Bidirectionally sync the crosshair between two or more charts. When the mouse
moves on one chart, the crosshair guide, marker dots, and tooltip card appear on
all synced charts at the matching x coordinate — ideal for multi-panel dashboards
where you want to compare the same time window across views.

```ts
chart1.sync(chart2);
chart1.sync(chart3);
```

Calling `sync()` pairs charts in both directions — there is no master/slave
relationship. The crosshair position on one chart is mirrored on every synced
target.

---

## Custom tooltips (DOM)

The `onHover` callback fires on every `mousemove` with the interpolated data
for every visible series at the cursor position. Use it to build DOM-based
tooltips, update framework state, or pipe values into external widgets.

```ts
chart.onHover = (hits) => {
  myTooltipEl.innerHTML = hits.map((h) => `${h.label}: ${h.yVal.toFixed(1)}`).join('<br>');
};
```

Each hit contains the series name, colour, interpolated (x, y) value, and the
pixel position. See the `SeriesHit` type for the full shape.

---

## Export (PNG)

Call `toImage()` to export the current canvas as a PNG data URL. Useful for
reports, screenshots, or image-generation pipelines.

```ts
const url = chart.toImage();
// e.g. <img src="..."> or download link
```

---

## Accessibility

Goro Charts renders to Canvas 2D, which is not natively accessible to screen
readers. The library compensates with several built-in features:

- **`role="img"`** + dynamic **`aria-label`** on the canvas element, updated
  each draw with a summary of visible series values.
- **Keyboard navigation** — when the canvas is focused (Tab key), use:
  - ← / → to move the crosshair 1 data point
  - Shift + ← / → to move 10 data points
  - Escape to hide the crosshair
- **`aria-live` region** — crosshair values are announced to screen readers
  via a hidden `aria-live="polite"` element inserted next to the canvas.
- **`prefers-reduced-motion`** — when the user's system preference is set,
  the chart disables `requestAnimationFrame` coalescing and draws synchronously.
- **`prefers-contrast: more`** — grid and text colours are boosted for
  readability when the user requests higher contrast.
- **`forced-colors: active`** — the chart uses CSS system colours (`Canvas`,
  `CanvasText`, `GrayText`) when Windows High Contrast Mode is active.

The canvas element receives `tabindex="0"` so it can receive keyboard focus.
For optimal accessibility, pair the chart with a data table fallback rendered
outside the canvas.

---

## Troubleshooting

### Canvas is blank / black

- Ensure the canvas element has non-zero CSS width and height.
- Check that `chart.draw()` is being called after `setData()` (or enable
  `autoDraw` for streaming mode).
- If using `ResizeObserver` in a container with `display: none`, the canvas
  may have zero dimensions. Call `chart.draw()` after the container becomes
  visible.

### "Canvas 2D context not available"

- This error means `canvas.getContext('2d')` returned `null`. Common causes:
  - The canvas element does not exist in the DOM at construction time.
  - The canvas was already claimed by a WebGL context.
  - You are running in a server-side environment (Node.js without `node-canvas`).

### "append() requires the chart to be created with { maxPoints }"

- Streaming methods (`append`, `appendBatch`) require ring mode, which is
  activated by passing `maxPoints` (a positive number) to the constructor.
- Use `setData()` for snapshot mode (full replacement).

### Crosshair does not appear

- The crosshair only shows when the mouse is inside the plot area (the inner
  rectangle after padding is applied).
- Check that `onHover` or mouse events are not being consumed by an overlay
  element above the canvas.

### Performance is slow with many points

- Verify that decimation is working: the line/area renderers auto-switch to
  per-pixel-column decimation when `count > 2 × plotWidth`.
- For scatter charts, reduce `maxDots` (default 2000) or set it to a lower
  value to increase stride thinning.
- Use `suspendDraw()` / `resumeDraw()` when batch-loading large datasets.

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
