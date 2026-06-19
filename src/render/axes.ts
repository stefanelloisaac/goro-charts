/**
 * @file Grid lines, axis lines, and tick labels.
 *
 * Pure renderers over a SeriesView and a PlotRect. Tick values come from the
 * nice-tick generator; positions come from the linear scale. Grid and axis
 * passes are each batched into a single stroke.
 */

import type { Domain, PlotRect, ResolvedOpts } from '../types.ts'
import { generateTicks } from '../math/ticks.ts'
import { formatNumber } from '../math/format.ts'
import { xToPx, yToPx } from '../math/scale.ts'

/** Draw the background grid (horizontal + vertical lines at tick positions). */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  d: Domain,
  plot: PlotRect,
  opts: ResolvedOpts,
): void {
  ctx.strokeStyle = opts.gridColor
  ctx.lineWidth = 0.5

  const yTicks = generateTicks(d.yMin, d.yMax, opts.yTicks)
  ctx.beginPath()
  for (const y of yTicks) {
    const py = yToPx(y, d, plot)
    ctx.moveTo(plot.x, py)
    ctx.lineTo(plot.x + plot.w, py)
  }
  ctx.stroke()

  const xTicks = generateTicks(d.xMin, d.xMax, opts.xTicks)
  ctx.beginPath()
  for (const x of xTicks) {
    const px = xToPx(x, d, plot)
    ctx.moveTo(px, plot.y)
    ctx.lineTo(px, plot.y + plot.h)
  }
  ctx.stroke()
}

/** Draw axis tick labels (Y on the left, X below) and the L-shaped axes. */
export function renderAxes(
  ctx: CanvasRenderingContext2D,
  d: Domain,
  plot: PlotRect,
  opts: ResolvedOpts,
): void {
  ctx.font = `${opts.fontSize}px ${opts.fontFamily}`
  ctx.fillStyle = opts.textColor

  const yTicks = generateTicks(d.yMin, d.yMax, opts.yTicks)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const y of yTicks) {
    ctx.fillText(formatNumber(y), plot.x - 6, yToPx(y, d, plot))
  }

  const xTicks = generateTicks(d.xMin, d.xMax, opts.xTicks)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const x of xTicks) {
    ctx.fillText(formatNumber(x), xToPx(x, d, plot), plot.y + plot.h + 6)
  }

  ctx.strokeStyle = opts.axisColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(plot.x, plot.y)
  ctx.lineTo(plot.x, plot.y + plot.h)
  ctx.moveTo(plot.x, plot.y + plot.h)
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h)
  ctx.stroke()
}
