/**
 * @file Scatter chart — one filled circle per (sampled) point.
 *
 * Uses stride thinning via {@link renderScatter}: when the dataset exceeds
 * `maxDots` every Nth point is drawn so the chart stays responsive. The
 * thinning step is `floor(n / maxDots)`.
 */

import { ChartBase } from './chart-base.ts';
import { renderScatter } from '../render/scatter.ts';
import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts';

/** High-performance Canvas 2D scatter chart. */
export class ScatterChart extends ChartBase {
  protected renderSeries(ctx: CanvasRenderingContext2D, view: SeriesView, plot: PlotRect, opts: ResolvedOpts): void {
    renderScatter(ctx, view, plot, opts);
  }
}
