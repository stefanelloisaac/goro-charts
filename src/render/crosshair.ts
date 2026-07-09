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

import type { SeriesView, SeriesConfig, PlotRect, ResolvedOpts, ScaleType } from '../types.ts';
import { formatNumber, formatTimeTick } from '../math/format.ts';
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
  /** Index of this series in the chart's series array (for resolving per-series formatters). */
  seriesIndex: number;
}

/**
 * Compute interpolated hit data for every non-empty series at `cursorX`.
 * Called internally by {@link renderCrosshair} and available for the
 * `onHover` callback so consumers can build custom tooltips.
 *
 * The `!Number.isFinite(yVal)` guard below already implements "tooltip
 * ignores absent values" (§6.4): `yVal` is interpolated straight from the
 * raw stored `yArr`, so a `NaN` sample (or interpolation straddling one)
 * drops the hit regardless of the series' `gapMode` — gapMode only affects
 * how gaps are *drawn*, never the tooltip readout.
 *
 * @param scaleType - Scale type forwarded to `pxToX`/`xToPx`. Default `'linear'`.
 *   `'band'` throws until v1.9.0.
 */
export function computeHits(
  views: readonly SeriesView[],
  configs: readonly SeriesConfig[],
  plot: PlotRect,
  cursorX: number,
  scaleType?: ScaleType,
): SeriesHit[] {
  const hits: SeriesHit[] = [];

  for (let s = 0; s < views.length; s++) {
    if (configs[s].hidden) continue;
    const view = views[s];
    const n = view.count;
    if (n === 0) continue;

    const cursorVal = pxToX(cursorX, view, plot, scaleType);
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
    const px = xToPx(xVal, view, plot, scaleType);
    const py = yToPx(yVal, view, plot);

    // A hit only exists when its marker would be visible inside the plot.
    // This keeps marker dots, tooltip rows, onHover, and live-region output
    // consistent with what the chart actually renders in the plot area.
    if (!Number.isFinite(yVal) || !Number.isFinite(px) || !Number.isFinite(py)) continue;
    if (px < plot.x || px > plot.x + plot.w) continue;
    if (py < plot.y || py > plot.y + plot.h) continue;

    hits.push({
      px,
      py,
      xVal,
      yVal,
      color: configs[s].color,
      label: configs[s].name,
      seriesIndex: s,
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

  const hits = computeHits(views, configs, plot, cursor.x, opts.xAxis.type);
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
  // Value formatting precedence (§6.2): per-series SeriesConfig.valueFormat
  // wins over the chart-wide ChartOpts.tooltip.valueFormat, which wins over
  // the default formatNumber.
  const fv = (h: SeriesHit): string => {
    const cfg = configs[h.seriesIndex];
    if (cfg.valueFormat) return cfg.valueFormat(h.yVal);
    if (opts.tooltip.valueFormat) return opts.tooltip.valueFormat({ value: h.yVal, series: cfg });
    return formatNumber(h.yVal);
  };
  // X row formatting precedence: tooltip.xFormat wins, else a time-aware
  // default when the axis is time-scaled, else formatNumber.
  const fxRow = (x: number): string => {
    if (opts.tooltip.xFormat) return opts.tooltip.xFormat(x);
    if (opts.xAxis.type === 'time') return formatTimeTick(x, 'second', opts.xAxis.timeZone);
    return formatNumber(x);
  };
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
  const valueW = Math.max(...hits.map((h) => ctx.measureText(fv(h)).width));

  ctx.font = nameFont;
  const xLabelW = ctx.measureText('x').width;
  ctx.font = valueFont;
  const xValW = ctx.measureText(fxRow(cursorX)).width;

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
  ctx.fillText(fxRow(cursorX), tx + cardW - pad, xRowY + rowH - 4);

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
    ctx.fillText(fv(h), tx + cardW - pad, ry + rowH - 4);
  }

  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}
