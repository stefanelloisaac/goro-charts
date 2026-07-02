/**
 * @file Stacked area bands for a group of series with the same `stack` id.
 *
 * Each layer renders as a polyline band between its own cumulative Y and the
 * previous layer's cumulative Y (or the plot bottom for the first layer). Fill
 * covers the band; the top edge is stroked separately. Sparse regime only
 * (n ≤ 2·plotW) — stacked charts rarely carry millions of points per series.
 * A decimated path matching {@link renderLine} can be added when needed.
 *
 * The crosshair uses the same cumulative arrays via proxy views built by the
 * orchestrator, so dots line up with band edges.
 */

import type { SeriesView, PlotRect, Domain } from '../types.ts';

interface LayerStyle {
  lineColor: string;
  lineWidth: number;
  fillColor: string;
  fillOpacity: number;
}

/**
 * Render stacked area bands for a group of series sharing one `stack` key.
 *
 * @param stores one SeriesView per layer, bottom to top (index 0 = first)
 * @param styles per-series fill/stroke configs
 * @param plot the plot rectangle in CSS pixels
 * @param domain shared data-space extents (left or right grid domain)
 */
export function renderStackedBands(
  ctx: CanvasRenderingContext2D,
  stores: readonly SeriesView[],
  styles: readonly LayerStyle[],
  plot: PlotRect,
  domain: Domain,
): void {
  const n = stores[0].count;
  if (n === 0) return;

  const first = stores[0];
  const { xArr, cap } = first;

  const xRange = domain.xMax - domain.xMin;
  const yRange = domain.yMax - domain.yMin;
  const xScale = xRange > 0 ? plot.w / xRange : 0;
  const xOff = plot.x - domain.xMin * xScale;
  const yScale = yRange > 0 ? plot.h / yRange : 0;
  const yOff = plot.y + plot.h + domain.yMin * yScale;
  const bottomY = plot.y + plot.h;

  // Pre-compute cumulative Y for each layer (logical order).
  const cumYArr: Float64Array[] = [];
  const running = new Float64Array(n);
  for (let li = 0; li < stores.length; li++) {
    const s = stores[li];
    let p = s.head;
    let toWrap = s.cap - s.head;
    for (let j = 0; j < n; j++) {
      running[j] += s.yArr[p];
      if (--toWrap === 0) {
        p = 0;
        toWrap = s.cap;
      } else p++;
    }
    cumYArr.push(new Float64Array(running));
  }

  // Walk x in logical order (shared across all stores).
  const xs: Float64Array = new Float64Array(n);
  let p = first.head;
  let toWrap = cap - first.head;
  for (let j = 0; j < n; j++) {
    xs[j] = xOff + xArr[p] * xScale;
    if (--toWrap === 0) {
      p = 0;
      toWrap = cap;
    } else p++;
  }

  ctx.lineJoin = 'round';

  for (let li = 0; li < stores.length; li++) {
    const cumCurr = cumYArr[li];
    const style = styles[li];

    // Fill: band between previous cum Y (or bottom) and current cum Y.
    ctx.beginPath();
    ctx.fillStyle = style.fillColor;
    if (style.fillOpacity < 1) ctx.globalAlpha = style.fillOpacity;

    // Forward along current cumulative line.
    ctx.moveTo(xs[0], yOff - cumCurr[0] * yScale);
    for (let j = 1; j < n; j++) {
      ctx.lineTo(xs[j], yOff - cumCurr[j] * yScale);
    }

    if (li === 0) {
      // Close along plot bottom.
      ctx.lineTo(xs[n - 1], bottomY);
      ctx.lineTo(xs[0], bottomY);
    } else {
      // Walk backward along previous cumulative line.
      const cumPrev = cumYArr[li - 1];
      for (let j = n - 1; j >= 0; j--) {
        ctx.lineTo(xs[j], yOff - cumPrev[j] * yScale);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stroke: only the top polyline of this layer.
    ctx.beginPath();
    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = 'round';
    ctx.moveTo(xs[0], yOff - cumCurr[0] * yScale);
    for (let j = 1; j < n; j++) {
      ctx.lineTo(xs[j], yOff - cumCurr[j] * yScale);
    }
    ctx.stroke();
  }
}
