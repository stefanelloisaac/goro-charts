/**
 * @file Interactive crosshair with an interpolated, multi-series tooltip card.
 *
 * The cursor x maps to an exact data value. For each non-empty series, y is
 * linearly interpolated between the two samples bracketing the cursor, so the
 * readout slides smoothly and never jumps by whole samples even where many
 * points share a pixel column. The bracket search runs on logical indices (x
 * is sorted there) and translates to physical slots, correct under ring
 * wraparound.
 *
 * A dashed vertical guide line is always drawn. A horizontal guide appears
 * only when exactly one series is visible (N lines would be noise otherwise).
 * Per-series marker dots sit on the interpolated points, coloured from
 * {@link SeriesConfig}. The tooltip is a rounded card with an `x` header row,
 * a subtle divider, and one row per series showing a colour dot, the series
 * name, and the interpolated value right-aligned.
 */

import type { SeriesView, SeriesConfig, PlotRect, ResolvedOpts } from '../types.ts'
import { formatNumber } from '../math/format.ts'
import { xToPx, yToPx, pxToX } from '../math/scale.ts'
import { roundedRect } from './shape.ts'

interface SeriesHit {
  px: number
  py: number
  xVal: number
  yVal: number
  color: string
  label: string
}

export function renderCrosshair(
  ctx: CanvasRenderingContext2D,
  views: readonly SeriesView[],
  configs: readonly SeriesConfig[],
  plot: PlotRect,
  opts: ResolvedOpts,
  cursor: { x: number; y: number },
  cssW: number,
): void {
  if (cursor.x < plot.x || cursor.x > plot.x + plot.w) return
  if (cursor.y < plot.y || cursor.y > plot.y + plot.h) return

  const hits: SeriesHit[] = []
  let cursorX = 0
  let guidePx = 0

  for (let s = 0; s < views.length; s++) {
    const view = views[s]
    const n = view.count
    if (n === 0) continue

    const cursorVal = pxToX(cursor.x, view, plot)
    const loLogical = view.bracketLogical(cursorVal)
    const hiLogical = loLogical + 1 < n ? loLogical + 1 : n - 1
    const lo = view.physOf(loLogical)
    const hi = view.physOf(hiLogical)

    const x0 = view.xArr[lo]
    const x1 = view.xArr[hi]
    const y0 = view.yArr[lo]
    const y1 = view.yArr[hi]
    let t = x1 > x0 ? (cursorVal - x0) / (x1 - x0) : 0
    if (t < 0) t = 0
    else if (t > 1) t = 1
    const xVal = x0 + (x1 - x0) * t
    const yVal = y0 + (y1 - y0) * t

    const cfg = configs[s]
    hits.push({
      px: xToPx(xVal, view, plot),
      py: yToPx(yVal, view, plot),
      xVal,
      yVal,
      color: cfg.color,
      label: cfg.name,
    })

    cursorX = xVal
    guidePx = hits[0].px
  }

  if (hits.length === 0) return

  // Dashed vertical guide
  ctx.strokeStyle = opts.crosshairColor
  ctx.lineWidth = opts.crosshairWidth
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(guidePx, plot.y)
  ctx.lineTo(guidePx, plot.y + plot.h)
  ctx.stroke()
  ctx.setLineDash([])

  // Dashed horizontal guide — only with a single visible series
  if (hits.length === 1) {
    const h = hits[0]
    ctx.strokeStyle = opts.crosshairColor
    ctx.lineWidth = opts.crosshairWidth
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(plot.x, h.py)
    ctx.lineTo(plot.x + plot.w, h.py)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Marker dots with a dark halo behind so they read over filled areas
  for (const h of hits) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.beginPath()
    ctx.arc(h.px, h.py, opts.pointRadius + 1.5, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = h.color
    ctx.beginPath()
    ctx.arc(h.px, h.py, opts.pointRadius, 0, Math.PI * 2)
    ctx.fill()
  }

  // ---- Tooltip card ----------------------------------------------------
  const fx = (n: number) => formatNumber(n)
  const nameFont = `${opts.fontSize}px ${opts.fontFamily}`
  const valueFont = `600 ${opts.fontSize + 1}px ${opts.fontFamily}`
  const pad = 10
  const dotR = 4
  const colGap = 8
  const rowH = opts.fontSize + 6
  const cardR = 6

  // Measure name column width
  ctx.font = nameFont
  const nameW = Math.max(...hits.map((h) => ctx.measureText(h.label).width))

  // Measure value column width
  ctx.font = valueFont
  const valueW = Math.max(...hits.map((h) => ctx.measureText(fx(h.yVal)).width))

  // Header: "x <value>" — same layout as series rows
  ctx.font = nameFont
  const xLabelW = ctx.measureText('x').width
  ctx.font = valueFont
  const xValW = ctx.measureText(fx(cursorX)).width

  const col2W = Math.max(0, nameW, xLabelW)           // series name column
  const col3W = Math.max(valueW, xValW)               // value column (right aligned)

  const cardW = pad * 2 + dotR * 2 + colGap + col2W + colGap + col3W
  const headerH = rowH + 4
  const dividerH = 2
  const cardH = pad * 2 + headerH + dividerH + hits.length * rowH

  // Position: right of cursor, clamped to canvas
  let tx = guidePx + 14
  if (tx + cardW > cssW) tx = Math.max(2, guidePx - cardW - 14)
  let ty = cursor.y - cardH - 10
  if (ty < 2) ty = cursor.y + 10

  // Card background
  ctx.fillStyle = 'rgba(10,12,14,0.70)'
  ctx.beginPath()
  roundedRect(ctx, tx, ty, cardW, cardH, cardR)
  ctx.fill()

  // Card border
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  roundedRect(ctx, tx, ty, cardW, cardH, cardR)
  ctx.stroke()

  // Header row: x with dot placeholder, then value
  const xRowY = ty + pad
  ctx.fillStyle = opts.textColor
  ctx.globalAlpha = 0.5
  ctx.font = nameFont
  ctx.fillText('x', tx + pad + dotR * 2 + colGap, xRowY + rowH - 4)
  ctx.globalAlpha = 1

  ctx.font = valueFont
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText(fx(cursorX), tx + cardW - pad, xRowY + rowH - 4)

  // Divider
  const divY = ty + pad + headerH + 1
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tx + pad, divY)
  ctx.lineTo(tx + cardW - pad, divY)
  ctx.stroke()

  // Series rows
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    const ry = ty + pad + headerH + dividerH + i * rowH

    // Colour dot
    ctx.fillStyle = h.color
    ctx.beginPath()
    ctx.arc(tx + pad + dotR, ry + rowH / 2, dotR, 0, Math.PI * 2)
    ctx.fill()

    // Series name
    ctx.font = nameFont
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText(h.label, tx + pad + dotR * 2 + colGap, ry + rowH - 4)

    // Value
    ctx.font = valueFont
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,255,255,0.90)'
    ctx.fillText(fx(h.yVal), tx + cardW - pad, ry + rowH - 4)
  }

  ctx.textAlign = 'left'
  ctx.globalAlpha = 1
}
