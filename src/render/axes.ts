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
import { generateTicks, generateTimeTicks, type TimeTickUnit } from '../math/ticks.ts';
import { formatNumber, formatTimeTick } from '../math/format.ts';
import { xToPx, yToPx } from '../math/scale.ts';

/**
 * Resolve the X-axis tick values for the current domain, dispatching on
 * `opts.xAxis.type`. Kept as a single helper so `renderGrid` (line
 * placement) and `renderAxes` (label placement) never drift out of sync.
 */
function resolveXTicks(d: Domain, opts: ResolvedOpts): { values: number[]; unit?: TimeTickUnit } {
  if (opts.xAxis.type === 'time') return generateTimeTicks(d.xMin, d.xMax, opts.xTicks);
  // linear and band use the same numeric tick generator; band will get its
  // own tick logic in v1.9.0.
  return { values: generateTicks(d.xMin, d.xMax, opts.xTicks) };
}

/** Resolve the display label for one X tick, honouring `xAxis.tickFormat` and the time-aware default. */
function formatXTick(x: number, unit: TimeTickUnit | undefined, opts: ResolvedOpts): string {
  if (opts.xAxis.tickFormat) return opts.xAxis.tickFormat(x);
  if (opts.xAxis.type === 'time' && unit) return formatTimeTick(x, unit, opts.xAxis.timeZone);
  return formatNumber(x);
}

/** Resolve the display label for one Y tick, honouring `yAxis.tickFormat`. */
function formatYTick(y: number, opts: ResolvedOpts): string {
  return opts.yAxis.tickFormat ? opts.yAxis.tickFormat(y) : formatNumber(y);
}

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
  const { values: xTicks } = resolveXTicks(d, opts);
  ctx.beginPath();
  for (const x of xTicks) {
    const px = xToPx(x, d, plot, opts.xAxis.type);
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
    ctx.fillText(formatYTick(y, opts), ypx, yToPx(y, d, plot));
  }

  // X labels only on the left side (they share the same x domain)
  if (side === 'left') {
    const { values: xTicks, unit } = resolveXTicks(d, opts);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const x of xTicks) {
      ctx.fillText(formatXTick(x, unit, opts), xToPx(x, d, plot, opts.xAxis.type), plot.y + plot.h + 6);
    }
  }
}
