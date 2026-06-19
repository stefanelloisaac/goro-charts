/**
 * @file Scatter plot — one circle per (sampled) point.
 *
 * When the dataset is far denser than `maxDots` every `floor(n / maxDots)`-th
 * point is drawn (stride thinning) so the chart stays responsive. Thinning
 * skips the binary-search overhead of true polyline decimation; scatter
 * doesn't benefit from an envelope anyway because each point carries its own
 * visual weight.
 */

import type { SeriesView, PlotRect, ResolvedOpts } from '../types.ts'

/** Advance a physical index by `k` positions, modulo `cap`. */
function advance(p: number, k: number, cap: number): number {
  const next = p + k
  return next >= cap ? next - cap : next
}

export function renderScatter(
  ctx: CanvasRenderingContext2D,
  view: SeriesView,
  plot: PlotRect,
  opts: ResolvedOpts,
): void {
  const { xArr, yArr, count: n, cap } = view
  if (n === 0) return

  const xRange = view.xMax - view.xMin
  const yRange = view.yMax - view.yMin
  const xScale = xRange > 0 ? plot.w / xRange : 0
  const xOff = plot.x - view.xMin * xScale
  const yScale = yRange > 0 ? plot.h / yRange : 0
  const yOff = plot.y + plot.h + view.yMin * yScale

  const maxDots = opts.maxDots
  const step = n > maxDots ? Math.max(1, Math.floor(n / maxDots)) : 1
  const r = opts.pointRadius

  let p = view.head

  ctx.fillStyle = opts.lineColor
  ctx.beginPath()

  for (let i = 0; i < n; i += step) {
    const px = xOff + xArr[p] * xScale
    const py = yOff - yArr[p] * yScale
    ctx.moveTo(px + r, py)
    ctx.arc(px, py, r, 0, Math.PI * 2)
    p = advance(p, step, cap)
  }
  ctx.fill()
}
