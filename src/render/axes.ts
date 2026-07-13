/**
 * @file Grid and tick labels.
 *
 * Pure renderers over a {@link Domain} and a {@link PlotRect}. The grid is a
 * dashed internal lattice plus an explicit rectangular frame around the plot —
 * the frame is an explicit `strokeRect` so it always closes into a box,
 * independent of tick placement. Tick labels sit outside the frame with no
 * extra axis strokes (the frame itself is the axis boundary).
 *
 * Both {@link renderGrid} and {@link renderAxes} accept an optional
 * {@link TickCache} argument. When provided, they consume pre-computed ticks
 * and labels — eliminating duplicate `generateTicks` calls (grid vs axes) and
 * `formatTimeTick` / `formatNumber` calls on every frame (the streaming-ring
 * sliding path reuses labels when the tick set is stable).
 */

import type { Domain, PlotRect, ResolvedOpts } from '../types.ts';
import { generateTicks, generateTimeTicks, type TimeTickUnit } from '../math/ticks.ts';
import { formatNumber, formatTimeTick } from '../math/format.ts';
import { TickCache } from '../math/tick-cache.ts';
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
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  d: Domain,
  plot: PlotRect,
  opts: ResolvedOpts,
  cache?: TickCache,
): void {
  ctx.setLineDash([6, 4]);

  const bottom = plot.y + plot.h;
  const right = plot.x + plot.w;

  ctx.strokeStyle = opts.gridColor;
  ctx.lineWidth = 0.5;

  // Dashed horizontal lines — skip if they land exactly on the top/bottom
  // boundary (the frame handles those edges).
  const yTicks = cache ? cache.yLeftTicks : generateTicks(d.yMin, d.yMax, opts.yTicks);
  ctx.beginPath();
  for (const y of yTicks) {
    const py = yToPx(y, d, plot);
    if (py <= plot.y || py >= bottom) continue;
    ctx.moveTo(plot.x, py);
    ctx.lineTo(right, py);
  }
  ctx.stroke();

  // Dashed vertical lines — skip if they land on left/right boundary.
  const xTicks = cache ? cache.xTicks : resolveXTicks(d, opts).values;
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
  cache?: TickCache,
): void {
  ctx.font = `${opts.fontSize}px ${opts.fontFamily}`;
  ctx.fillStyle = opts.textColor;

  const yTicks = cache
    ? side === 'right'
      ? cache.yRightTicks
      : cache.yLeftTicks
    : generateTicks(d.yMin, d.yMax, opts.yTicks);
  const yLabels: readonly string[] = cache ? (side === 'right' ? cache.yRightLabels : cache.yLeftLabels) : [];

  ctx.textAlign = side === 'right' ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  const ypx = side === 'right' ? plot.x + plot.w + 6 : plot.x - 6;
  for (let i = 0; i < yTicks.length; i++) {
    const label = cache ? yLabels[i] : formatYTick(yTicks[i], opts);
    ctx.fillText(label, ypx, yToPx(yTicks[i], d, plot));
  }

  // X labels only on the left side (they share the same x domain)
  if (side === 'left') {
    const xTicks = cache ? cache.xTicks : resolveXTicks(d, opts).values;
    const xUnit = cache ? cache.xUnit : resolveXTicks(d, opts).unit;
    const xLabels: readonly string[] = cache ? cache.xLabels : [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < xTicks.length; i++) {
      const label = cache ? xLabels[i] : formatXTick(xTicks[i], xUnit, opts);
      ctx.fillText(label, xToPx(xTicks[i], d, plot, opts.xAxis.type), plot.y + plot.h + 6);
    }
  }
}
