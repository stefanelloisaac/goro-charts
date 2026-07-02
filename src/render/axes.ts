/**
 * @file Grid and tick labels.
 *
 * Pure renderers over a {@link Domain} and a {@link PlotRect}. The grid is a
 * dashed internal lattice plus an explicit rectangular frame around the plot —
 * the frame is an explicit `strokeRect` so it always closes into a box,
 * independent of tick placement. Tick labels sit outside the frame with no
 * extra axis strokes (the frame itself is the axis boundary).
 */

import type { Domain, PlotRect, ResolvedOpts } from '../types.ts';
import { generateTicks } from '../math/ticks.ts';
import { formatNumber } from '../math/format.ts';
import { xToPx, yToPx } from '../math/scale.ts';

/** Draw the background grid (dashed internal lines + closed frame). */
export function renderGrid(ctx: CanvasRenderingContext2D, d: Domain, plot: PlotRect, opts: ResolvedOpts): void {
  ctx.setLineDash([6, 4]);

  const bottom = plot.y + plot.h;
  const right = plot.x + plot.w;

  ctx.strokeStyle = opts.gridColor;
  ctx.lineWidth = 0.5;

  // Dashed horizontal lines — skip if they land exactly on the top/bottom
  // boundary (the frame handles those edges).
  const yTicks = generateTicks(d.yMin, d.yMax, opts.yTicks);
  ctx.beginPath();
  for (const y of yTicks) {
    const py = yToPx(y, d, plot);
    if (py <= plot.y || py >= bottom) continue;
    ctx.moveTo(plot.x, py);
    ctx.lineTo(right, py);
  }
  ctx.stroke();

  // Dashed vertical lines — skip if they land on left/right boundary.
  const xTicks = generateTicks(d.xMin, d.xMax, opts.xTicks);
  ctx.beginPath();
  for (const x of xTicks) {
    const px = xToPx(x, d, plot);
    if (px <= plot.x || px >= right) continue;
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, bottom);
  }
  ctx.stroke();

  // The frame is a single explicit rectangle — it always closes, regardless
  // of where the ticks land. Slightly stronger than internal grid lines.
  ctx.strokeStyle = opts.axisColor;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

  ctx.setLineDash([]);
}

/** Draw axis tick labels (Y on the left or right, X below). No axis strokes — the grid frame is the boundary. */
export function renderAxes(
  ctx: CanvasRenderingContext2D,
  d: Domain,
  plot: PlotRect,
  opts: ResolvedOpts,
  side: 'left' | 'right' = 'left',
): void {
  ctx.font = `${opts.fontSize}px ${opts.fontFamily}`;
  ctx.fillStyle = opts.textColor;

  const yTicks = generateTicks(d.yMin, d.yMax, opts.yTicks);
  ctx.textAlign = side === 'right' ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  const ypx = side === 'right' ? plot.x + plot.w + 6 : plot.x - 6;
  for (const y of yTicks) {
    ctx.fillText(formatNumber(y), ypx, yToPx(y, d, plot));
  }

  // X labels only on the left side (they share the same x domain)
  if (side === 'left') {
    const xTicks = generateTicks(d.xMin, d.xMax, opts.xTicks);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const x of xTicks) {
      ctx.fillText(formatNumber(x), xToPx(x, d, plot), plot.y + plot.h + 6);
    }
  }
}
