# Goro Charts

Minimal high-performance chart engine. **Canvas 2D only. Zero runtime dependencies. Framework-agnostic.** Inspired by [uPlot](https://github.com/leeoniya/uPlot) — small, fast, and covers only what you need.

- **LineChart** — batched polyline with per-pixel-column decimation
- **AreaChart** — filled region below the line (same decimation, closed path)
- Columnar `Float64Array` data (no object-per-point overhead)
- Single `beginPath()`/`stroke()` batch render (hardware-accelerated)
- Per-pixel-column min/max decimation (500k points → ~2·width segments)
- Streaming ring mode with O(1) append and O(1) sliding-window min/max
- `devicePixelRatio`-aware for sharp retina rendering
- Offscreen canvas for static content → crosshair is instant
- `ResizeObserver` auto-sizing, `rAF`-coalesced auto-draw

```bash
npm install goro-charts
```

---

## Usage

```ts
import { LineChart, AreaChart } from 'goro-charts'

const canvas = document.getElementById('chart') as HTMLCanvasElement
const line = new LineChart(canvas, { maxPoints: 2000, autoDraw: true })
const area = new AreaChart(canvas, { maxPoints: 2000, autoDraw: true, fillColor: 'rgba(78,168,255,0.12)' })
```

### Snapshot mode — `setData()`

Replace the whole series. Extents computed once (O(n)).

```ts
const x = new Float64Array([0, 1, 2, 3, 4])
const y = new Float64Array([10, 20, 15, 30, 25])
chart.setData(x, y)
chart.draw() // manual; skipped if autoDraw is on
```

### Streaming mode — `append()` / `appendBatch()`

Push samples incrementally. Window slides automatically; min/max maintained in O(1) via a monotonic deque. Requires `maxPoints`.

```ts
const chart = new LineChart(canvas, { maxPoints: 2000, autoDraw: true })

chart.append(0, 10)
chart.append(1, 45)

// Batch append (one coalesced draw)
chart.appendBatch([3, 4, 5], [67, 12, 89])
```

---

## Chart types

### LineChart

```ts
new LineChart(canvas, opts?: ChartOpts)
```

The default. Draws the series as a single batched polyline. In dense datasets (more than 2× the plot width in samples) it auto-switches to per-pixel-column min/max decimation — the visual envelope of the signal — so 500k points render as ~2×width segments with no aliasing.

### AreaChart

```ts
new AreaChart(canvas, opts?: ChartOpts)
```

Same rendering + decimation as `LineChart`, plus a filled region between the line and the plot bottom. The fill colour and opacity are controlled by the standard options `fillColor` and `fillOpacity`.

---

## Options

```ts
new LineChart(canvas, opts)
new AreaChart(canvas, opts)
```

| Option | Default | Description |
|---|---|---|
| `padding` | `[16, 16, 32, 56]` | `[top, right, bottom, left]` in CSS pixels |
| `lineColor` | `'#4ea8ff'` | Line stroke color |
| `lineWidth` | `1.5` | Line stroke width |
| `fillColor` | `'rgba(78,168,255,0.15)'` | Area fill (AreaChart) |
| `fillOpacity` | `0.15` | Area fill opacity (AreaChart) |
| `gridColor` | `'rgba(255,255,255,0.08)'` | Grid line color |
| `axisColor` | `'rgba(255,255,255,0.25)'` | Axis line color |
| `textColor` | `'rgba(255,255,255,0.5)'` | Tick label color |
| `fontSize` | `11` | Tick label font size |
| `fontFamily` | `'system-ui, …'` | Tick label font family |
| `bgColor` | `'#111'` | Background fill |
| `crosshairColor` | `'rgba(255,255,255,0.3)'` | Crosshair guide lines |
| `crosshairWidth` | `1` | Crosshair guide line width |
| `pointRadius` | `4` | Crosshair marker dot radius |
| `pointColor` | `'#4ea8ff'` | Crosshair marker dot color |
| `xTicks` | `8` | Approximate X-axis tick count |
| `yTicks` | `6` | Approximate Y-axis tick count |
| `maxPoints` | `0` | Activate ring (streaming) mode with this window size |
| `autoDraw` | `false` | Coalesce data changes into one `rAF` draw |

---

## Methods

| Method | Description |
|---|---|
| `setData(x, y)` | Snapshot mode. Replace entire series. O(n). |
| `append(x, y)` | Ring mode. Append one sample. O(1). |
| `appendBatch(xs, ys)` | Ring mode. Append batch. O(k). |
| `setMaxPoints(n)` | Resize the streaming window. |
| `clear()` | Empty the current data. |
| `draw()` | Manual paint. No-op when clean. |
| `destroy()` | Detach observers and release buffers. |

## Properties (read-only)

| Property | Type | Description |
|---|---|---|
| `pointCount` | `number` | Samples in the window |
| `lastValue` | `number` | Most recent y (NaN if empty) |
| `extentMin` | `number` | Window y minimum (O(1)) |
| `extentMax` | `number` | Window y maximum (O(1)) |

---

## Architecture

```
src/
  index.ts             Public barrel
  chart-base.ts        Abstract orchestrator (data, surface, dirty/rAF, interaction)
  line-chart.ts        LineChart — renders via renderLine
  area-chart.ts        AreaChart — renders via renderArea
  types.ts             ChartOpts, SeriesView, PlotRect, Domain
  defaults.ts          Baseline options

  data/                Data model layer
    monotonic-extent   O(1) sliding min/max via dual monotonic deques
    ring-buffer        O(1) append ring, no memmove
    series-store       Unified snapshot + ring store, logical addressing

  render/              Pure Canvas 2D drawing functions
    surface            DPR, offscreen buffer, blit
    axes               Grid + axis lines + tick labels
    line               Batched line with per-pixel decimation
    area               Batched area fill + stroke (same decimation)
    crosshair          Interpolated crosshair + tooltip

  math/                Stateless math utilities
    scale              Data ↔ pixel transforms
    ticks              Nice tick generation (1, 2, 5 × 10ⁿ)
    format             Numeric label formatting
```

## License

MIT
