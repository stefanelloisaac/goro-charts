/**
 * @file The series line, drawn as a single batched stroke.
 *
 * Two regimes share one path:
 *
 *  - Dense (count > 2·plotW): per-pixel-column min/max decimation. Drawing
 *    every point would smear into a solid band and alias badly; instead each
 *    pixel column collapses to first→min→max→last, joined so adjacent columns
 *    form one continuous ribbon (the signal's visual envelope). Collapses
 *    500k points to ~2·width segments.
 *
 *  - Sparse: the real polyline, point for point.
 *
 * Both walk logical order over physical storage using a `toWrap` countdown
 * instead of a modulo per point (snapshot mode never wraps; ring mode wraps
 * once). The scale arithmetic is inlined for hot-loop speed.
 */

import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts';

/** Render the series line into `ctx` for the given view and plot rect. */
export function renderLine(ctx: CanvasRenderingContext2D, view: SeriesView, plot: PlotRect, opts: ResolvedOpts): void {
  const { xArr, yArr, count: n, cap } = view;
  if (n === 0) return;

  ctx.strokeStyle = opts.lineColor;
  ctx.lineWidth = opts.lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();

  const xRange = view.xMax - view.xMin;
  const yRange = view.yMax - view.yMin;
  const xScale = xRange > 0 ? plot.w / xRange : 0;
  const xOff = plot.x - view.xMin * xScale;
  const yScale = yRange > 0 ? plot.h / yRange : 0;
  const yOff = plot.y + plot.h + view.yMin * yScale;

  let p = view.head;
  let toWrap = cap - view.head;

  if (n > plot.w * 2) {
    let col = -1;
    let colMinY = 0;
    let colMaxY = 0;
    let colFirstY = 0;
    let colLastY = 0;
    let started = false;

    const flush = (cx: number) => {
      ctx.lineTo(cx, colFirstY);
      ctx.lineTo(cx, colMinY);
      ctx.lineTo(cx, colMaxY);
      ctx.lineTo(cx, colLastY);
    };

    for (let i = 0; i < n; i++) {
      const px = xOff + xArr[p] * xScale;
      const c = px | 0;
      const py = yOff - yArr[p] * yScale;

      if (c !== col) {
        if (started) flush(col + 0.5);
        else {
          ctx.moveTo(c + 0.5, py);
          started = true;
        }
        col = c;
        colMinY = py;
        colMaxY = py;
        colFirstY = py;
        colLastY = py;
      } else {
        if (py < colMinY) colMinY = py;
        if (py > colMaxY) colMaxY = py;
        colLastY = py;
      }

      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }
    if (started) flush(col + 0.5);
  } else {
    ctx.moveTo(xOff + xArr[p] * xScale, yOff - yArr[p] * yScale);
    if (--toWrap === 0) {
      p = 0;
      toWrap = cap;
    } else p++;
    for (let i = 1; i < n; i++) {
      ctx.lineTo(xOff + xArr[p] * xScale, yOff - yArr[p] * yScale);
      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }
  }

  ctx.stroke();
}
