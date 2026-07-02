/**
 * @file Area chart — filled region below the series line.
 *
 * Same batched path + decimation as {@link LineChart}, but the path is closed
 * to the plot bottom so a single `fill()` paints the area, with the stroke
 * line drawn on top for readability even at low fill opacity.
 */

import { ChartBase } from './chart-base.ts';
import { renderArea } from '../render/area.ts';
import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts';

/** High-performance Canvas 2D area chart. */
export class AreaChart extends ChartBase {
  protected renderSeries(ctx: CanvasRenderingContext2D, view: SeriesView, plot: PlotRect, opts: ResolvedOpts): void {
    renderArea(ctx, view, plot, opts);
  }
}
