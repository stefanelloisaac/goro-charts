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
 *
 * `opts.gapMode` (v1.6.0) controls how a `NaN` Y sample renders. Under
 * `'break'` a run of consecutive valid samples becomes its own closed
 * fill + open stroke (so the fill never bridges a gap); `'connect'` skips
 * gap samples so valid neighbours join into a single run; `'zero'` treats a
 * gap sample as `0` for this draw only, so every sample stays in one run.
 */

import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts';

/**
 * One decimated pixel column. 5 numbers per column: centre-x and the four Y
 * values that trace the envelope in order (first → min → max → last).
 * Maximum ~plot.w entries — a few hundred, not half a million.
 */
type ColData = [number, number, number, number, number];

/** Paint the closed fill + open top stroke for one contiguous run of columns/points. */
function paintRun(ctx: CanvasRenderingContext2D, run: readonly ColData[], bottomY: number, opts: ResolvedOpts): void {
  const firstCol = run[0];
  const lastCol = run[run.length - 1];

  // Fill: closed path (envelope + bottom edges)
  ctx.beginPath();
  ctx.moveTo(firstCol[0], firstCol[1]);
  for (const col of run) {
    ctx.lineTo(col[0], col[1]);
    ctx.lineTo(col[0], col[2]);
    ctx.lineTo(col[0], col[3]);
    ctx.lineTo(col[0], col[4]);
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
  for (const col of run) {
    ctx.lineTo(col[0], col[1]);
    ctx.lineTo(col[0], col[2]);
    ctx.lineTo(col[0], col[3]);
    ctx.lineTo(col[0], col[4]);
  }
  ctx.stroke();
}

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
  // Fall back to the documented default when a caller (or an older test
  // fixture) omits gapMode — ResolvedOpts always sets it in production.
  const gapMode = opts.gapMode ?? 'break';

  let p = view.head;
  let toWrap = cap - view.head;

  ctx.lineJoin = 'round';

  const N_DENSE = plot.w * 2;

  if (n > N_DENSE) {
    // ---- Decimated: one pass collecting column data grouped into runs,
    // split on an all-gap column under 'break' — then paint each run.
    const runs: ColData[][] = [];
    let currentRun: ColData[] = [];
    let ci = -1;
    let cMinY = 0;
    let cMaxY = 0;
    let cFirstY = 0;
    let cLastY = 0;
    let colHasData = false;

    const closeColumn = () => {
      if (colHasData) {
        currentRun.push([ci + 0.5, cFirstY, cMinY, cMaxY, cLastY]);
      } else if (gapMode === 'break' && currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
    };

    for (let i = 0; i < n; i++) {
      const px = xOff + xArr[p] * xScale;
      const c = px | 0;
      const rawY = yArr[p];
      const isGap = Number.isNaN(rawY);

      if (c !== ci) {
        closeColumn();
        ci = c;
        colHasData = false;
      }

      if (!isGap || gapMode === 'zero') {
        const y = isGap ? 0 : rawY;
        const py = yOff - y * yScale;
        if (!colHasData) {
          cFirstY = cMinY = cMaxY = cLastY = py;
          colHasData = true;
        } else {
          if (py < cMinY) cMinY = py;
          if (py > cMaxY) cMaxY = py;
          cLastY = py;
        }
      }

      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }
    closeColumn();
    if (currentRun.length > 0) runs.push(currentRun);

    for (const run of runs) paintRun(ctx, run, bottomY, opts);
  } else {
    // ---- Sparse: collect points into runs (n is small, ≤ 2×plot.w), then paint each.
    const runs: ColData[][] = [];
    let currentRun: ColData[] = [];
    p = view.head;
    toWrap = cap - view.head;
    for (let i = 0; i < n; i++) {
      const rawY = yArr[p];
      const isGap = Number.isNaN(rawY);

      if (isGap && gapMode !== 'zero') {
        if (gapMode === 'break' && currentRun.length > 0) {
          runs.push(currentRun);
          currentRun = [];
        }
        // 'connect': skip the sample entirely.
      } else {
        const y = isGap ? 0 : rawY;
        const px = xOff + xArr[p] * xScale;
        const py = yOff - y * yScale;
        // Point runs reuse ColData's 5-tuple shape (first=min=max=last=py)
        // so paintRun's envelope drawing works unchanged for single points.
        currentRun.push([px, py, py, py, py]);
      }

      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }
    if (currentRun.length > 0) runs.push(currentRun);

    for (const run of runs) paintRun(ctx, run, bottomY, opts);
  }
}
