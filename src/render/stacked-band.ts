/**
 * @file Stacked area bands for a group of series with the same `stack` id.
 *
 * Each layer renders as a polyline band between its own cumulative Y and the
 * previous layer's cumulative Y (or the plot bottom for the first layer). Fill
 * covers the band; the top edge is stroked separately.
 *
 * Two regimes, mirroring {@link renderLine} / {@link renderArea}:
 *
 *  - **Dense** (n > 2·plotW): per-pixel-column decimation. Each pixel column
 *    collapses to its min/max cumulative Y, so a full window of N points per
 *    layer becomes ~2·plotW column samples — the visual envelope of the band —
 *    instead of N line segments. This is what keeps a 10k-point stacked chart
 *    at the same cost as a decimated area chart.
 *
 *  - **Sparse** (n ≤ 2·plotW): the real cumulative polyline, point for point.
 *
 * Y values are clamped to the plot rect so a band never spills past the frame
 * even if the domain lags the accumulated values.
 *
 * The crosshair uses the (undecimated) cumulative arrays via proxy views built
 * by the orchestrator, so dots line up with band edges.
 */

import type { SeriesView, PlotRect, Domain } from '../types.ts';
import { resolveRenderWindow } from '../math/window.ts';

interface LayerStyle {
  lineColor: string;
  lineWidth: number;
  fillColor: string;
  fillOpacity: number;
}

/**
 * Decimated column samples for one layer's cumulative edge. Parallel arrays:
 * `cx[k]` is the column centre x; `top[k]` / `bot[k]` are the min/max cumulative
 * Y pixels in that column (top = smaller y = higher value). Length ≤ ~plotW.
 */
interface Decimated {
  cx: number[];
  top: number[];
  bot: number[];
}

/**
 * Render stacked area bands for a group of series sharing one `stack` key.
 *
 * @param stores one SeriesView per layer, bottom to top (index 0 = first)
 * @param styles per-series fill/stroke configs
 * @param plot the plot rectangle in CSS pixels
 * @param domain shared data-space extents (left or right grid domain)
 */
export function renderStackedBands(
  ctx: CanvasRenderingContext2D,
  stores: readonly SeriesView[],
  styles: readonly LayerStyle[],
  plot: PlotRect,
  domain: Domain,
): void {
  const first = stores[0];
  if (first.count === 0) return;

  // v1.7.0 windowing: only iterate the samples inside the visible domain.
  // Cumulative Y at each logical index is a sum *across layers* at that same
  // index — it does NOT depend on samples at lower indices — so restricting
  // the logical range to `[iStart, iEnd]` produces the exact same cumulative
  // values for the visible slice as the full-range version, at O(nVis * L)
  // work instead of O(nTotal * L).
  const win = resolveRenderWindow(first, domain.xMin, domain.xMax);
  if (win.iEnd < win.iStart) return;
  const nVis = win.iEnd - win.iStart + 1;

  const { xArr, cap } = first;

  const xRange = domain.xMax - domain.xMin;
  const yRange = domain.yMax - domain.yMin;
  const xScale = xRange > 0 ? plot.w / xRange : 0;
  const xOff = plot.x - domain.xMin * xScale;
  const yScale = yRange > 0 ? plot.h / yRange : 0;
  const yOff = plot.y + plot.h + domain.yMin * yScale;
  const bottomY = plot.y + plot.h;
  const topY = plot.y;

  // Clamp a data-space cumulative Y to a pixel inside the plot rect.
  const clampY = (yPx: number): number => (yPx < topY ? topY : yPx > bottomY ? bottomY : yPx);
  const py = (cumY: number): number => clampY(yOff - cumY * yScale);

  // Pre-compute cumulative Y for each layer, but only over the visible
  // window `[iStart, iEnd]`. A `NaN` sample (v1.6.0 gap) contributes 0 at
  // that index instead of poisoning the sum — documented stacking-gap
  // contract (§6.4). Each layer starts at its own physical slot for
  // `iStart` via `physOf`, so ring wraparound still works.
  const cumYArr: Float64Array[] = [];
  const running = new Float64Array(nVis);
  for (let li = 0; li < stores.length; li++) {
    const s = stores[li];
    let p = s.physOf(win.iStart);
    let toWrap = s.cap - p;
    for (let j = 0; j < nVis; j++) {
      const v = s.yArr[p];
      if (!Number.isNaN(v)) running[j] += v;
      if (--toWrap === 0) {
        p = 0;
        toWrap = s.cap;
      } else p++;
    }
    cumYArr.push(new Float64Array(running));
  }

  ctx.lineJoin = 'round';

  const pStart = win.pStart;
  if (nVis > plot.w * 2) {
    renderDecimated(ctx, cumYArr, styles, xArr, pStart, cap, xOff, xScale, py, bottomY);
  } else {
    renderSparse(ctx, cumYArr, styles, xArr, pStart, cap, nVis, xOff, xScale, py, bottomY);
  }
}

/** Sparse regime: draw the real cumulative polyline for each layer. */
function renderSparse(
  ctx: CanvasRenderingContext2D,
  cumYArr: Float64Array[],
  styles: readonly LayerStyle[],
  xArr: Float64Array<ArrayBufferLike>,
  head: number,
  cap: number,
  n: number,
  xOff: number,
  xScale: number,
  py: (cumY: number) => number,
  bottomY: number,
): void {
  // Walk x in logical order once (shared across all layers).
  const xs = new Float64Array(n);
  let p = head;
  let toWrap = cap - head;
  for (let j = 0; j < n; j++) {
    xs[j] = xOff + xArr[p] * xScale;
    if (--toWrap === 0) {
      p = 0;
      toWrap = cap;
    } else p++;
  }

  for (let li = 0; li < cumYArr.length; li++) {
    const cumCurr = cumYArr[li];
    const style = styles[li];

    ctx.beginPath();
    ctx.fillStyle = style.fillColor;
    if (style.fillOpacity < 1) ctx.globalAlpha = style.fillOpacity;

    ctx.moveTo(xs[0], py(cumCurr[0]));
    for (let j = 1; j < n; j++) ctx.lineTo(xs[j], py(cumCurr[j]));

    if (li === 0) {
      ctx.lineTo(xs[n - 1], bottomY);
      ctx.lineTo(xs[0], bottomY);
    } else {
      const cumPrev = cumYArr[li - 1];
      for (let j = n - 1; j >= 0; j--) ctx.lineTo(xs[j], py(cumPrev[j]));
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = 'round';
    ctx.moveTo(xs[0], py(cumCurr[0]));
    for (let j = 1; j < n; j++) ctx.lineTo(xs[j], py(cumCurr[j]));
    ctx.stroke();
  }
}

/**
 * Dense regime: collapse each layer's cumulative edge to per-pixel-column
 * min/max, then fill each band between its decimated edge and the previous
 * layer's decimated edge (or the plot bottom).
 */
function renderDecimated(
  ctx: CanvasRenderingContext2D,
  cumYArr: Float64Array[],
  styles: readonly LayerStyle[],
  xArr: Float64Array<ArrayBufferLike>,
  head: number,
  cap: number,
  xOff: number,
  xScale: number,
  py: (cumY: number) => number,
  bottomY: number,
): void {
  const n = cumYArr[0].length;

  // Pre-compute the column index for each logical sample once (shared x).
  const colOf = new Int32Array(n);
  {
    let p = head;
    let toWrap = cap - head;
    for (let j = 0; j < n; j++) {
      colOf[j] = (xOff + xArr[p] * xScale) | 0;
      if (--toWrap === 0) {
        p = 0;
        toWrap = cap;
      } else p++;
    }
  }

  // Decimate each layer into per-column min/max cumulative Y pixels.
  const layers: Decimated[] = cumYArr.map((cum) => {
    const cx: number[] = [];
    const top: number[] = [];
    const bot: number[] = [];
    let col = -1;
    let minY = 0;
    let maxY = 0;
    for (let j = 0; j < n; j++) {
      const c = colOf[j];
      const yPx = py(cum[j]);
      if (c !== col) {
        if (col >= 0) {
          cx.push(col + 0.5);
          top.push(minY);
          bot.push(maxY);
        }
        col = c;
        minY = maxY = yPx;
      } else {
        if (yPx < minY) minY = yPx;
        if (yPx > maxY) maxY = yPx;
      }
    }
    if (col >= 0) {
      cx.push(col + 0.5);
      top.push(minY);
      bot.push(maxY);
    }
    return { cx, top, bot };
  });

  for (let li = 0; li < layers.length; li++) {
    const cur = layers[li];
    const m = cur.cx.length;
    if (m === 0) continue;
    const style = styles[li];

    // Fill: forward along current edge (use bot = lower value edge for a solid
    // envelope), then close along previous layer's edge (or the plot bottom).
    ctx.beginPath();
    ctx.fillStyle = style.fillColor;
    if (style.fillOpacity < 1) ctx.globalAlpha = style.fillOpacity;

    ctx.moveTo(cur.cx[0], cur.top[0]);
    for (let k = 0; k < m; k++) {
      ctx.lineTo(cur.cx[k], cur.top[k]);
      ctx.lineTo(cur.cx[k], cur.bot[k]);
    }

    if (li === 0) {
      ctx.lineTo(cur.cx[m - 1], bottomY);
      ctx.lineTo(cur.cx[0], bottomY);
    } else {
      const prev = layers[li - 1];
      for (let k = prev.cx.length - 1; k >= 0; k--) {
        ctx.lineTo(prev.cx[k], prev.bot[k]);
        ctx.lineTo(prev.cx[k], prev.top[k]);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stroke: the top envelope of this layer only.
    ctx.beginPath();
    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = 'round';
    ctx.moveTo(cur.cx[0], cur.top[0]);
    for (let k = 0; k < m; k++) {
      ctx.lineTo(cur.cx[k], cur.top[k]);
      ctx.lineTo(cur.cx[k], cur.bot[k]);
    }
    ctx.stroke();
  }
}
