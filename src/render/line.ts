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
 *
 * `opts.gapMode` (v1.6.0) controls how a `NaN` Y sample renders:
 *  - `'break'` (default): lifts the pen — no line crosses the gap.
 *  - `'connect'`: the gap sample is skipped, so its valid neighbours join
 *    directly.
 *  - `'zero'`: the gap sample is treated as `0` for this draw only.
 */

import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts';
import { resolveRenderWindow } from '../math/window.ts';

/** Render the series line into `ctx` for the given view and plot rect. */
export function renderLine(ctx: CanvasRenderingContext2D, view: SeriesView, plot: PlotRect, opts: ResolvedOpts): void {
  const { xArr, yArr, count: n, cap } = view;
  if (n === 0) return;

  // v1.7.0 windowing: iterate only the logical range that can affect a pixel
  // column, not the whole series. Under an active viewport this collapses a
  // 500k-point series to ≈ 2·plot.w work per frame.
  const win = resolveRenderWindow(view, view.xMin, view.xMax);
  if (win.iEnd < win.iStart) return;
  const nVisible = win.iEnd - win.iStart + 1;

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
  // Fall back to the documented default when a caller (or an older test
  // fixture) omits gapMode — ResolvedOpts always sets it in production.
  const gapMode = opts.gapMode ?? 'break';

  let p = win.pStart;
  let toWrap = win.toWrapStart;

  if (nVisible > plot.w * 2) {
    let col = -1;
    let colMinY = 0;
    let colMaxY = 0;
    let colFirstY = 0;
    let colLastY = 0;
    let colHasData = false;
    // Whether a sub-path is currently open (moveTo already issued) — the
    // decimation-loop equivalent of a "pen down" state.
    let segOpen = false;

    const flush = (cx: number) => {
      ctx.lineTo(cx, colFirstY);
      ctx.lineTo(cx, colMinY);
      ctx.lineTo(cx, colMaxY);
      ctx.lineTo(cx, colLastY);
    };

    // Close out the column currently being accumulated (`col`), called right
    // before moving to a different column and once more after the loop for
    // the final column. An empty column (all-NaN under 'break'/'connect')
    // lifts the pen for 'break' only; 'connect' silently bridges over it.
    const closeColumn = () => {
      if (!colHasData) {
        if (gapMode === 'break') segOpen = false;
        return;
      }
      if (segOpen) flush(col + 0.5);
      // else: the moveTo for this column's first point already ran inline.
    };

    for (let i = win.iStart; i <= win.iEnd; i++) {
      const px = xOff + xArr[p] * xScale;
      const c = px | 0;
      const rawY = yArr[p];
      const isGap = Number.isNaN(rawY);

      if (c !== col) {
        closeColumn();
        col = c;
        colHasData = false;
      }

      if (!isGap || gapMode === 'zero') {
        const y = isGap ? 0 : rawY;
        const py = yOff - y * yScale;
        if (!colHasData) {
          colFirstY = colMinY = colMaxY = colLastY = py;
          colHasData = true;
          if (!segOpen) {
            ctx.moveTo(col + 0.5, py);
            segOpen = true;
          }
        } else {
          if (py < colMinY) colMinY = py;
          if (py > colMaxY) colMaxY = py;
          colLastY = py;
        }
      }

      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }
    closeColumn();
  } else {
    // Whether a sub-path is currently open — 'break' lifts the pen at a gap
    // so the next valid point re-opens with moveTo instead of lineTo.
    let segOpen = false;
    for (let i = win.iStart; i <= win.iEnd; i++) {
      const rawY = yArr[p];
      const isGap = Number.isNaN(rawY);

      if (isGap && gapMode !== 'zero') {
        if (gapMode === 'break') segOpen = false;
        // 'connect': skip the sample entirely — the next valid point joins
        // directly from wherever the pen currently is.
      } else {
        const y = isGap ? 0 : rawY;
        const px = xOff + xArr[p] * xScale;
        const py = yOff - y * yScale;
        if (!segOpen) {
          ctx.moveTo(px, py);
          segOpen = true;
        } else {
          ctx.lineTo(px, py);
        }
      }

      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }
  }

  ctx.stroke();
}
