/**
 * @file Shared types and the data/render contract.
 *
 * `ChartOpts` is the public configuration surface shared by all chart types.
 * `SeriesConfig` drives per-series styling. `PlotRect` and `Domain` are small
 * value objects passed to the pure renderers. `SeriesView` is the read-only
 * contract the renderers depend on instead of the concrete data store — it
 * decouples `render/` from `data/` so either can change independently.
 */

/** Per-series visual configuration. */
export interface SeriesConfig {
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
}

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
