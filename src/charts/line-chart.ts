/**
 * @file Line chart — the default series drawn as a single batched polyline.
 *
 * Supports the decimation auto-switch: dense data collapses to a per-pixel
 * min/max envelope ribbon; sparse data draws the real polyline. For the
 * full algorithm details see {@link renderLine}.
 */

import { ChartBase } from './chart-base.ts'
import { renderLine } from '../render/line.ts'
import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts'

/** High-performance Canvas 2D line chart. */
export class LineChart extends ChartBase {
  protected renderSeries(
    ctx: CanvasRenderingContext2D,
    view: SeriesView,
    plot: PlotRect,
    opts: ResolvedOpts,
  ): void {
    renderLine(ctx, view, plot, opts)
  }
}
