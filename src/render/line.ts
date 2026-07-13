/**
 * @file The series line, drawn as a single batched stroke.
 *
 * Two regimes share one path:
 *
 *  - Dense (count > 2·plotW): per-pixel-column min/max decimation. Drawing
 *    every point would smear into a solid band and alias badly; instead each
 *    pixel column collapses to its min→max range and adjacent columns are
 *    joined into one continuous ribbon (the signal's visual envelope).
 *    Collapses 500k points to ~width segments.
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
 *
 * In the dense regime the envelope is one continuous ribbon: adjacent columns
 * are always joined horizontally. `gapMode` only decides what happens at an
 * empty (all-NaN) column: `'break'` lifts the pen so the ribbon does not cross
 * the gap; `'connect'` keeps the pen down so the ribbon bridges across;
 * `'zero'` folds gap samples into the envelope as `0` (no empty column).
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
  const dense = nVisible > plot.w * 2;
  ctx.lineJoin = dense ? 'bevel' : 'round';
  ctx.lineCap = dense ? 'butt' : 'round';
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

  if (dense) {
    let col = -1;
    let colMinY = 0;
    let colMaxY = 0;
    let colHasData = false;
    // The envelope is ONE continuous sub-path: each populated column joins the
    // previous one horizontally, then sweeps its own min↔max range, so adjacent
    // columns form a solid ribbon (not isolated vertical dashes). `penDown`
    // tracks whether the sub-path is open. A 'break' gap lifts the pen; a
    // 'connect' gap keeps it down so the ribbon bridges across.
    let penDown = false;

    const flush = (cx: number) => {
      // Enter this column: re-open with moveTo after a lifted pen, otherwise
      // join from the previous column with lineTo (the horizontal link).
      if (!penDown) {
        ctx.moveTo(cx, colMinY);
        penDown = true;
      } else {
        ctx.lineTo(cx, colMinY);
      }
      // Sweep the column's vertical envelope; the pen ends at colMaxY so the
      // next column joins from there.
      ctx.lineTo(cx, colMaxY);
    };

    // Close out the column currently being accumulated (`col`), called right
    // before moving to a different column and once more after the loop for
    // the final column. An empty column (all-NaN) emits no envelope stroke;
    // under 'break' it also lifts the pen so the ribbon does not cross the gap.
    const closeColumn = () => {
      if (colHasData) flush(col + 0.5);
      else if (gapMode === 'break') penDown = false;
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
          colMinY = colMaxY = py;
          colHasData = true;
        } else {
          if (py < colMinY) colMinY = py;
          if (py > colMaxY) colMaxY = py;
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
