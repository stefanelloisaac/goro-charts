/**
 * @file Shared types and the data/render contract.
 *
 * `ChartOpts` is the public configuration surface shared by all chart types.
 * `SeriesConfig` drives per-series styling. `PlotRect` and `Domain` are small
 * value objects passed to the pure renderers. `SeriesView` is the read-only
 * contract the renderers depend on instead of the concrete data store — it
 * decouples `render/` from `data/` so either can change independently.
 */

/**
 * Data-array ownership for snapshot mode (`setData`).
 *
 * - `'copy'` (default): the store copies the caller's arrays into fresh buffers;
 *   the caller may mutate the originals freely without affecting the chart.
 * - `'borrowed'`: the store keeps the caller's arrays by reference — the caller
 *   **must** treat them as immutable for as long as the chart holds them. The
 *   arrays are read-only to the chart; mutating them externally leads to
 *   undefined behaviour.
 */
export type DataOwnership = 'copy' | 'borrowed';

/**
 * Reference to a series: either its 0-based index or its `id`.
 *
 * Every data and metric method accepts a `SeriesRef`. A `string` is resolved
 * to the series whose {@link SeriesConfig.id} matches; a `number` is used as a
 * direct index.
 */
export type SeriesRef = number | string;

/**
 * Axis coordinate scale.
 *
 * - `'linear'` — continuous numeric.
 * - `'time'` — epoch-ms treated as continuous; tick labels are calendar-aware.
 * - `'band'` — categorical positions. Reserved for the v1.9.0 bar chart. The
 *   type is recognised so consumers can reference it; the transform itself is
 *   stubbed with a descriptive error until v1.9.0.
 */
export type ScaleType = 'linear' | 'time' | 'band';

/**
 * How a series renders a `NaN` (missing) sample.
 *
 * - `'break'` (default): lifts the pen — no line/fill crosses the gap.
 * - `'connect'`: skips the missing sample so its neighbours join directly.
 * - `'zero'`: treats the missing sample as `0` for rendering only; the
 *   stored data is never mutated.
 */
export type GapMode = 'break' | 'connect' | 'zero';

/**
 * X-axis scale and tick/label configuration.
 *
 * Unrelated to {@link SeriesConfig.yAxis} (which picks left/right per series) —
 * this configures the axis's coordinate scale and formatting instead.
 */
export interface XAxisConfig {
  /** Coordinate scale for the X axis. Default `'linear'`. */
  type?: ScaleType;
  /** Custom tick/axis label formatter. Overrides the built-in default
   * (`formatNumber`, or the time-aware default when `type: 'time'`). */
  tickFormat?: (value: number) => string;
  /**
   * IANA time zone forwarded to the default time formatter when
   * `type: 'time'`. Only affects the built-in formatter — has no effect when
   * `tickFormat` is supplied; the library does not implement general time
   * zone conversion.
   */
  timeZone?: string;
}

/**
 * Y-axis tick/label configuration.
 *
 * Unrelated to {@link SeriesConfig.yAxis} (which picks left/right per
 * series) — this configures tick formatting shared by both Y axes.
 */
export interface YAxisConfig {
  /** Custom tick/axis label formatter. Overrides `formatNumber`. */
  tickFormat?: (value: number) => string;
}

/** Crosshair tooltip formatting. */
export interface TooltipConfig {
  /** Custom formatter for the tooltip's X row. Falls back to a time-aware
   * default when `xAxis.type === 'time'`, else `formatNumber`. */
  xFormat?: (value: number) => string;
  /** Custom formatter for a hit's Y value. {@link SeriesConfig.valueFormat}
   * takes precedence over this when both are set. */
  valueFormat?: (ctx: { value: number; series: SeriesConfig }) => string;
}

/** Per-series visual configuration. */
export interface SeriesConfig {
  /**
   * Stable identifier for this series. When set it must be unique across the
   * chart's series; duplicate ids are rejected at construction / `addSeries`.
   * Any data or metric method accepts this id in place of the numeric index.
   */
  id?: string;
  /** Display name for legends and the crosshair tooltip. */
  name: string;
  /** Line / dot colour for this series. */
  color: string;
  /** Line stroke width (AreaChart: top stroke width). */
  lineWidth?: number;
  /** Line dash pattern, e.g. `[8, 4]` for dashed lines. */
  dash?: number[];
  /** Area fill colour (only meaningful on an {@link AreaChart}). */
  fillColor?: string;
  /** Area fill opacity 0–1 (only meaningful on an {@link AreaChart}). */
  fillOpacity?: number;
  /** Which Y axis this series maps to. Default `'left'`. */
  yAxis?: 'left' | 'right';
  /**
   * Stack group identifier. Series with the same `stack` value render
   * cumulatively — each series' Y values are added to the previous series'
   * accumulated Y within the same group. Meaningful only on AreaChart.
   */
  stack?: string;
  /** Fixed Y lower bound for this series only (overrides the grid domain). */
  yMin?: number;
  /** Fixed Y upper bound for this series only (overrides the grid domain). */
  yMax?: number;
  /**
   * When true the series is excluded from rendering, the grid domain, and the
   * crosshair — as if it had no data. Toggle at runtime via
   * {@link ChartBase.showSeries} / {@link ChartBase.hideSeries}.
   */
  hidden?: boolean;
  /**
   * Per-series override of the tooltip value formatter. Takes precedence
   * over {@link TooltipConfig.valueFormat}.
   */
  valueFormat?: (value: number) => string;
  /** Per-series override of {@link ChartOpts.gapMode}. */
  gapMode?: GapMode;
}

/** Public configuration for a {@link LineChart} or {@link AreaChart}. */
export interface ChartOpts {
  /**
   * One entry per series. Each entry owns colour, width, and optional
   * name / fill properties. When omitted a single default series is used.
   */
  series?: SeriesConfig[];
  /** Padding [top, right, bottom, left] in CSS pixels. */
  padding?: [number, number, number, number];
  /** Per-series fallback line colour (overridden by SeriesConfig.color). */
  lineColor?: string;
  /** Per-series fallback line width (overridden by SeriesConfig.lineWidth). */
  lineWidth?: number;
  /** Per-series fallback area fill colour (overridden by SeriesConfig.fillColor). */
  fillColor?: string;
  /** Per-series fallback area fill opacity (overridden by SeriesConfig.fillOpacity). */
  fillOpacity?: number;
  /** Per-series fallback crosshair marker colour. */
  pointColor?: string;
  gridColor?: string;
  axisColor?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: string;
  crosshairColor?: string;
  crosshairWidth?: number;
  pointRadius?: number;
  bgColor?: string;
  /** Approximate number of X-axis ticks. */
  xTicks?: number;
  /** Approximate number of Y-axis ticks. */
  yTicks?: number;
  /**
   * Enable streaming "ring" mode with a sliding window of this many points.
   * Activates append()/appendBatch(); setData() still works (snapshot mode).
   */
  maxPoints?: number;
  /**
   * When true, append()/appendBatch() coalesce into a single
   * requestAnimationFrame draw instead of drawing synchronously — many
   * appends per frame collapse to one paint. Still demand-driven (no idle loop).
   */
  autoDraw?: boolean;
  /**
   * Fixed Y-axis lower bound. When set the grid domain is pinned to this
   * value instead of auto-expanding from data. `undefined` (default) = auto.
   * Pair with {@link yMax}.
   */
  yMin?: number;
  /**
   * Fixed Y-axis upper bound. When set the grid domain is pinned to this
   * value instead of auto-expanding from data. `undefined` (default) = auto.
   * Pair with {@link yMin}.
   */
  yMax?: number;
  /**
   * Max dots drawn by a {@link ScatterChart} before stride-thinning kicks
   * in (default 2000).
   */
  maxDots?: number;
  /** X axis scale type, tick formatting, and time zone. Default `{ type: 'linear' }`. */
  xAxis?: XAxisConfig;
  /** Y axis tick formatting (shared by both left and right axes). */
  yAxis?: YAxisConfig;
  /** Crosshair tooltip value/X formatting. */
  tooltip?: TooltipConfig;
  /**
   * Chart-wide default for how a series renders `NaN` samples. Default
   * `'break'`. Overridable per series via {@link SeriesConfig.gapMode}.
   */
  gapMode?: GapMode;
}

/**
 * Runtime option patch accepted by {@link ChartBase.setOptions}.
 *
 * Any subset of the top-level chart options may be supplied. Passing `series`
 * replaces the per-series config array wholesale (same length expected); to add
 * or remove series use {@link ChartBase.addSeries} / {@link ChartBase.removeSeries}.
 */
export type ChartOptionsPatch = Partial<ChartOpts>;

/** Fully-resolved options (every field present).
 *
 * `yMin` and `yMax` are `number | undefined` because `undefined` is the
 * sentinel for "auto" domain — `0` is a legitimate fixed bound. */
export type ResolvedOpts = Required<Omit<ChartOpts, 'yMin' | 'yMax'>> & {
  yMin: number | undefined;
  yMax: number | undefined;
};

/** Plot area rectangle in CSS pixels, padding already applied. */
export interface PlotRect {
  /** Left edge (x of the plot origin). */
  x: number;
  /** Top edge (y of the plot origin). */
  y: number;
  /** Plot width. */
  w: number;
  /** Plot height. */
  h: number;
}

/** Data-space extents for both axes. */
export interface Domain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Read-only view of the current series window that renderers consume.
 *
 * Data is stored columnar in physical backing arrays addressed through a
 * logical window `[0, count)`. In snapshot mode the logical and physical
 * indices coincide; in ring mode the window wraps, so `physOf` translates a
 * logical index to its physical slot. x is sorted in logical order.
 */
export interface SeriesView extends Domain {
  /** Physical backing array for x (length `cap`). */
  readonly xArr: Float64Array<ArrayBufferLike>;
  /** Physical backing array for y (length `cap`). */
  readonly yArr: Float64Array<ArrayBufferLike>;
  /** Physical index of logical position 0 (the oldest sample). */
  readonly head: number;
  /** Number of samples currently in the window. */
  readonly count: number;
  /** Physical capacity of the backing arrays. */
  readonly cap: number;
  /** Translate a logical index [0, count) to its physical slot. */
  physOf(logical: number): number;
  /**
   * Largest logical index whose x ≤ target (the left bracket), clamped to
   * [0, count-1]. Valid even when physical storage is wrapped.
   */
  bracketLogical(target: number): number;
}

// ---- Streaming & events (v1.5.0) -------------------------------------------

/**
 * Value map for {@link ChartBase.appendFrame}.
 *
 * Accepts a `Map<SeriesRef, number>` (index or id refs) or a plain
 * `Record<string, number>` (id → y). All entries share the same frame `x`.
 * Series absent from the map receive a carry-forward of their last `y` at the
 * frame's `x` so every active series stays ring-aligned frame-by-frame.
 * Series that have never received data are skipped until their first real
 * sample.
 */
export type ChartFrameValues = ReadonlyMap<SeriesRef, number> | Record<string, number>;

/** Payload emitted after a frame is appended. */
export interface FrameAppendedEvent {
  /** Number of series that received data (updated + carry-forward). */
  seriesUpdated: number;
  /** Whether the frame triggered a render (false when `autoDraw` is off or drawing is suspended). */
  render: boolean;
}

/** Payload emitted when the chart is destroyed. Reserved for future fields. */
export type ChartDestroyedEvent = Record<string, never>;

/**
 * User-controlled X-axis viewport (v1.7.0). When set, it overrides the
 * chart's auto/streaming/`fixedY`-style X domain logic entirely — see
 * {@link ChartOpts} and `ChartBase.setViewport`.
 *
 * By default (`yAuto: true`) the Y axis auto-scales to the samples *inside*
 * the visible X window — zooming into a small feature makes it fill the
 * plot vertically instead of staying flat against the global peak. Set
 * `yAuto: false` to keep Y anchored to the full-data extent (v1.7.0
 * behaviour). `ChartOpts.yMin`/`yMax` still win over both modes.
 */
export interface Viewport {
  xMin: number;
  xMax: number;
  /**
   * Whether to auto-scale Y to the samples inside `[xMin, xMax]`.
   * Default: `true`. `false` keeps Y bound to the full-data extent.
   */
  yAuto?: boolean;
}

/** Payload emitted whenever the viewport changes (`setViewport`, zoom, pan, `resetViewport`). */
export type ViewportChangeEvent = Viewport;

/** Event map for typed listeners. */
export interface ChartEventMap {
  frameappended: FrameAppendedEvent;
  destroy: ChartDestroyedEvent;
  viewportchange: ViewportChangeEvent;
}

export type ChartEventType = keyof ChartEventMap;

/** Typed listener for chart events. */
export type ChartEventListener<K extends ChartEventType> = (ev: ChartEventMap[K]) => void;
