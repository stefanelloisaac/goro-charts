/**
 * @file Interactive crosshair with an interpolated tooltip.
 *
 * The cursor x maps to an exact data value; y is linearly interpolated between
 * the two samples bracketing it, so the readout slides smoothly and never
 * jumps by whole samples even where many points share a pixel column. The
 * bracket search runs on logical indices (x is sorted there) and translates to
 * physical slots, so it is correct under ring wraparound. No-op when the
 * cursor is outside the plot rect.
 */

import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts'
import { formatNumber } from '../math/format.ts'
import { xToPx, yToPx, pxToX } from '../math/scale.ts'

/** Draw the crosshair lines, marker dot, and tooltip for the cursor position. */
export function renderCrosshair(
  ctx: CanvasRenderingContext2D,
  view: SeriesView,
  plot: PlotRect,
  opts: ResolvedOpts,
  cursor: { x: number; y: number },
  cssW: number,
): void {
  if (cursor.x < plot.x || cursor.x > plot.x + plot.w) return
  if (cursor.y < plot.y || cursor.y > plot.y + plot.h) return

  const n = view.count
  if (n === 0) return

  const { xArr, yArr } = view
  const cursorVal = pxToX(cursor.x, view, plot)
  const loLogical = view.bracketLogical(cursorVal)
  const hiLogical = loLogical + 1 < n ? loLogical + 1 : n - 1
  const lo = view.physOf(loLogical)
  const hi = view.physOf(hiLogical)

  const x0 = xArr[lo]
  const x1 = xArr[hi]
  const y0 = yArr[lo]
  const y1 = yArr[hi]
  let t = x1 > x0 ? (cursorVal - x0) / (x1 - x0) : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const xVal = x0 + (x1 - x0) * t
  const yVal = y0 + (y1 - y0) * t

  const px = xToPx(xVal, view, plot)
  const py = yToPx(yVal, view, plot)

  ctx.strokeStyle = opts.crosshairColor
  ctx.lineWidth = opts.crosshairWidth
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(px, plot.y)
  ctx.lineTo(px, plot.y + plot.h)
  ctx.moveTo(plot.x, py)
  ctx.lineTo(plot.x + plot.w, py)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = opts.pointColor
  ctx.beginPath()
  ctx.arc(px, py, opts.pointRadius, 0, Math.PI * 2)
  ctx.fill()

  const lx = `x: ${formatNumber(xVal)}`
  const ly = `y: ${formatNumber(yVal)}`
  ctx.font = `600 ${opts.fontSize}px ${opts.fontFamily}`

  const textW = Math.max(ctx.measureText(lx).width, ctx.measureText(ly).width) + 12
  const textH = opts.fontSize * 2 + 12

  let tx = px + 12
  if (tx + textW > cssW) tx = px - textW - 12
  let ty = py - textH - 8
  if (ty < 0) ty = py + 12

  ctx.fillStyle = 'rgba(0,0,0,0.85)'
  ctx.fillRect(tx, ty, textW, textH)

  ctx.fillStyle = opts.textColor
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(lx, tx + 6, ty + 6)
  ctx.fillText(ly, tx + 6, ty + 6 + opts.fontSize)
}
