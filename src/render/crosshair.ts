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
 * `computeHits` is exported so external code can build custom tooltips via the
 * {@link ChartBase.onHover} callback without re-implementing the interpolation
 * math. `renderCrosshair` uses it internally.
 */

import type { SeriesView, SeriesConfig, PlotRect, ResolvedOpts } from '../types.ts';
import { formatNumber } from '../math/format.ts';
import { xToPx, yToPx, pxToX } from '../math/scale.ts';
import { roundedRect } from './shape.ts';

/** Interpolated sample for one series at the cursor position. */
export interface SeriesHit {
  px: number;
  py: number;
  xVal: number;
  yVal: number;
  color: string;
  /** Series display name (from {@link SeriesConfig.name}). */
  label: string;
}

/**
 * Compute interpolated hit data for every non-empty series at `cursorX`.
 * Called internally by {@link renderCrosshair} and available for the
 * `onHover` callback so consumers can build custom tooltips.
 */
export function computeHits(
  views: readonly SeriesView[],
  configs: readonly SeriesConfig[],
  plot: PlotRect,
  cursorX: number,
): SeriesHit[] {
  const hits: SeriesHit[] = [];

  for (let s = 0; s < views.length; s++) {
    if (configs[s].hidden) continue;
    const view = views[s];
    const n = view.count;
    if (n === 0) continue;

    const cursorVal = pxToX(cursorX, view, plot);
    const loLogical = view.bracketLogical(cursorVal);
    const hiLogical = loLogical + 1 < n ? loLogical + 1 : n - 1;
    const lo = view.physOf(loLogical);
    const hi = view.physOf(hiLogical);

    const x0 = view.xArr[lo];
    const x1 = view.xArr[hi];
    const y0 = view.yArr[lo];
    const y1 = view.yArr[hi];
    let t = x1 > x0 ? (cursorVal - x0) / (x1 - x0) : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const xVal = x0 + (x1 - x0) * t;
    const yVal = y0 + (y1 - y0) * t;

    hits.push({
      px: xToPx(xVal, view, plot),
      py: yToPx(yVal, view, plot),
      xVal,
      yVal,
      color: configs[s].color,
      label: configs[s].name,
    });
  }
  return hits;
}

/** Draw the crosshair lines, marker dots, and multi-series tooltip card. */
export function renderCrosshair(
  ctx: CanvasRenderingContext2D,
  views: readonly SeriesView[],
  configs: readonly SeriesConfig[],
  plot: PlotRect,
  opts: ResolvedOpts,
  cursor: { x: number; y: number },
  cssW: number,
): void {
  if (cursor.x < plot.x || cursor.x > plot.x + plot.w) return;
  if (cursor.y < plot.y || cursor.y > plot.y + plot.h) return;

  const hits = computeHits(views, configs, plot, cursor.x);
  if (hits.length === 0) return;

  const guidePx = hits[0].px;
  const cursorX = hits[0].xVal;

  // Dashed vertical guide
  ctx.strokeStyle = opts.crosshairColor;
  ctx.lineWidth = opts.crosshairWidth;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(guidePx, plot.y);
  ctx.lineTo(guidePx, plot.y + plot.h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Dashed horizontal guide — only with a single visible series
  if (hits.length === 1) {
    const h = hits[0];
    ctx.strokeStyle = opts.crosshairColor;
    ctx.lineWidth = opts.crosshairWidth;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(plot.x, h.py);
    ctx.lineTo(plot.x + plot.w, h.py);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Marker dots with a dark halo behind so they read over filled areas
  for (const h of hits) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.arc(h.px, h.py, opts.pointRadius + 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.arc(h.px, h.py, opts.pointRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Tooltip card ----------------------------------------------------
  const fx = (n: number) => formatNumber(n);
  const nameFont = `${opts.fontSize}px ${opts.fontFamily}`;
  const valueFont = `600 ${opts.fontSize + 1}px ${opts.fontFamily}`;
  const pad = 10;
  const dotR = 4;
  const colGap = 8;
  const rowH = opts.fontSize + 6;
  const cardR = 6;

  ctx.font = nameFont;
  const nameW = Math.max(...hits.map((h) => ctx.measureText(h.label).width));

  ctx.font = valueFont;
  const valueW = Math.max(...hits.map((h) => ctx.measureText(fx(h.yVal)).width));

  ctx.font = nameFont;
  const xLabelW = ctx.measureText('x').width;
  ctx.font = valueFont;
  const xValW = ctx.measureText(fx(cursorX)).width;

  const col2W = Math.max(0, nameW, xLabelW);
  const col3W = Math.max(valueW, xValW);

  const cardW = pad * 2 + dotR * 2 + colGap + col2W + colGap + col3W;
  const headerH = rowH + 4;
  const dividerH = 2;
  const cardH = pad * 2 + headerH + dividerH + hits.length * rowH;

  let tx = guidePx + 14;
  if (tx + cardW > cssW) tx = Math.max(2, guidePx - cardW - 14);
  let ty = cursor.y - cardH - 10;
  if (ty < 2) ty = cursor.y + 10;
  // Avoid overflowing the plot area vertically
  if (ty + cardH > plot.y + plot.h) {
    ty = Math.max(2, cursor.y - cardH - 10);
  }

  ctx.fillStyle = 'rgba(10,12,14,0.70)';
  ctx.beginPath();
  roundedRect(ctx, tx, ty, cardW, cardH, cardR);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  roundedRect(ctx, tx, ty, cardW, cardH, cardR);
  ctx.stroke();

  const xRowY = ty + pad;
  ctx.fillStyle = opts.textColor;
  ctx.globalAlpha = 0.5;
  ctx.font = nameFont;
  ctx.fillText('x', tx + pad + dotR * 2 + colGap, xRowY + rowH - 4);
  ctx.globalAlpha = 1;

  ctx.font = valueFont;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(fx(cursorX), tx + cardW - pad, xRowY + rowH - 4);

  const divY = ty + pad + headerH + 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tx + pad, divY);
  ctx.lineTo(tx + cardW - pad, divY);
  ctx.stroke();

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const ry = ty + pad + headerH + dividerH + i * rowH;

    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.arc(tx + pad + dotR, ry + rowH / 2, dotR, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = nameFont;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(h.label, tx + pad + dotR * 2 + colGap, ry + rowH - 4);

    ctx.font = valueFont;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.90)';
    ctx.fillText(fx(h.yVal), tx + cardW - pad, ry + rowH - 4);
  }

  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}
