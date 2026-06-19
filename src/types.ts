/**
 * @file Shared types and the data/render contract.
 *
 * `ChartOpts` is the public configuration surface shared by all chart types.
 * `PlotRect` and `Domain` are small value objects passed to the pure
 * renderers. `SeriesView` is the read-only contract the renderers depend on
 * instead of the concrete data store — it decouples `render/` from `data/` so
 * either can change independently.
 */

/** Public configuration for a {@link LineChart} or {@link AreaChart}. */
export interface ChartOpts {
  /** Padding [top, right, bottom, left] in CSS pixels. */
  padding?: [number, number, number, number]
  lineColor?: string
  lineWidth?: number
  /** Area fill colour (only meaningful for AreaChart). */
  fillColor?: string
  /** Area fill opacity 0–1 (only meaningful for AreaChart). */
  fillOpacity?: number
  gridColor?: string
  axisColor?: string
  textColor?: string
  fontSize?: number
  fontFamily?: string
  crosshairColor?: string
  crosshairWidth?: number
  pointRadius?: number
  pointColor?: string
  bgColor?: string
  /** Approximate number of X-axis ticks. */
  xTicks?: number
  /** Approximate number of Y-axis ticks. */
  yTicks?: number
  /**
   * Enable streaming "ring" mode with a sliding window of this many points.
   * Activates append()/appendBatch(); setData() still works (snapshot mode).
   */
  maxPoints?: number
  /**
   * When true, append()/appendBatch() coalesce into a single
   * requestAnimationFrame draw instead of drawing synchronously — many
   * appends per frame collapse to one paint. Still demand-driven (no idle loop).
   */
  autoDraw?: boolean
}

/** Fully-resolved options (every field present). */
export type ResolvedOpts = Required<ChartOpts>

/** Plot area rectangle in CSS pixels, padding already applied. */
export interface PlotRect {
  /** Left edge (x of the plot origin). */
  x: number
  /** Top edge (y of the plot origin). */
  y: number
  /** Plot width. */
  w: number
  /** Plot height. */
  h: number
}

/** Data-space extents for both axes. */
export interface Domain {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
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
  readonly xArr: Float64Array<ArrayBufferLike>
  /** Physical backing array for y (length `cap`). */
  readonly yArr: Float64Array<ArrayBufferLike>
  /** Physical index of logical position 0 (the oldest sample). */
  readonly head: number
  /** Number of samples currently in the window. */
  readonly count: number
  /** Physical capacity of the backing arrays. */
  readonly cap: number
  /** Translate a logical index [0, count) to its physical slot. */
  physOf(logical: number): number
  /**
   * Largest logical index whose x ≤ target (the left bracket), clamped to
   * [0, count-1]. Valid even when physical storage is wrapped.
   */
  bracketLogical(target: number): number
}
