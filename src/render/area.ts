/**
 * @file The area fill + top-line stroke, drawn as separate batched paths.
 *
 * Shares the same per-pixel-column min/max decimation as {@link renderLine}.
 * Two paths are built from the same data so the fill covers the region below
 * the envelope while the stroke only traces the visible top line — the bottom
 * and side closure edges are never stroked.
 *
 * In the decimated regime each column's first→min→max→last edge pair is
 * recorded during the single pass (~plot-width entries, bounded); the filled
 * closure drops to the plot bottom, sweeps left, and rises to the start.
 */

import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts';

/**
 * One decimated pixel column. 5 numbers per column: centre-x and the four Y
 * values that trace the envelope in order (first → min → max → last).
 * Maximum ~plot.w entries — a few hundred, not half a million.
 */
type ColData = [number, number, number, number, number];

/** Render the filled area into `ctx` for the given view and plot rect. */
export function renderArea(ctx: CanvasRenderingContext2D, view: SeriesView, plot: PlotRect, opts: ResolvedOpts): void {
  const { xArr, yArr, count: n, cap } = view;
  if (n === 0) return;

  const xRange = view.xMax - view.xMin;
  const yRange = view.yMax - view.yMin;
  const xScale = xRange > 0 ? plot.w / xRange : 0;
  const xOff = plot.x - view.xMin * xScale;
  const yScale = yRange > 0 ? plot.h / yRange : 0;
  const yOff = plot.y + plot.h + view.yMin * yScale;
  const bottomY = plot.y + plot.h;

  let p = view.head;
  let toWrap = cap - view.head;

  ctx.lineJoin = 'round';

  const N_DENSE = plot.w * 2;

  if (n > N_DENSE) {
    // ---- Decimated: one pass collecting column data, then fill + stroke separately
    const cols: ColData[] = [];
    let ci = -1;
    let cMinY = 0;
    let cMaxY = 0;
    let cFirstY = 0;
    let cLastY = 0;

    for (let i = 0; i < n; i++) {
      const px = xOff + xArr[p] * xScale;
      const c = px | 0;
      const py = yOff - yArr[p] * yScale;

      if (c !== ci) {
        if (ci >= 0) cols.push([ci + 0.5, cFirstY, cMinY, cMaxY, cLastY]);
        ci = c;
        cMinY = cMaxY = cFirstY = cLastY = py;
      } else {
        if (py < cMinY) cMinY = py;
        if (py > cMaxY) cMaxY = py;
        cLastY = py;
      }

      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }
    if (ci >= 0) cols.push([ci + 0.5, cFirstY, cMinY, cMaxY, cLastY]);

    if (cols.length === 0) return;

    const firstCol = cols[0];
    const lastCol = cols[cols.length - 1];

    // Fill: closed path (envelope + bottom edges)
    ctx.beginPath();
    ctx.moveTo(firstCol[0], firstCol[1]);
    for (let i = 0; i < cols.length; i++) {
      const [, fy, minY, maxY, ly] = cols[i];
      ctx.lineTo(cols[i][0], fy);
      ctx.lineTo(cols[i][0], minY);
      ctx.lineTo(cols[i][0], maxY);
      ctx.lineTo(cols[i][0], ly);
    }
    ctx.lineTo(lastCol[0], bottomY);
    ctx.lineTo(firstCol[0], bottomY);
    ctx.closePath();

    ctx.fillStyle = opts.fillColor;
    if (opts.fillOpacity < 1) ctx.globalAlpha = opts.fillOpacity;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stroke: open path (top envelope only, no bottom edges)
    ctx.beginPath();
    ctx.strokeStyle = opts.lineColor;
    ctx.lineWidth = opts.lineWidth;
    ctx.lineCap = 'round';
    ctx.moveTo(firstCol[0], firstCol[1]);
    for (let i = 0; i < cols.length; i++) {
      const [, fy, minY, maxY, ly] = cols[i];
      ctx.lineTo(cols[i][0], fy);
      ctx.lineTo(cols[i][0], minY);
      ctx.lineTo(cols[i][0], maxY);
      ctx.lineTo(cols[i][0], ly);
    }
    ctx.stroke();
  } else {
    // ---- Sparse: two passes (n is small, ≤ 2×plot.w)
    // First pass: collect the polyline
    type Pt = [number, number];
    const pts: Pt[] = Array(n);
    p = view.head;
    toWrap = cap - view.head;
    for (let i = 0; i < n; i++) {
      pts[i] = [xOff + xArr[p] * xScale, yOff - yArr[p] * yScale];
      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }

    const firstX = pts[0][0];
    const lastX = pts[n - 1][0];

    // Fill: closed path
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(lastX, bottomY);
    ctx.lineTo(firstX, bottomY);
    ctx.closePath();

    ctx.fillStyle = opts.fillColor;
    if (opts.fillOpacity < 1) ctx.globalAlpha = opts.fillOpacity;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stroke: open path (top line only)
    ctx.beginPath();
    ctx.strokeStyle = opts.lineColor;
    ctx.lineWidth = opts.lineWidth;
    ctx.lineCap = 'round';
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
}
