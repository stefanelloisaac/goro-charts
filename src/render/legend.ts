/**
 * @file Legend drawn inside the plot area (top-right corner).
 *
 * Laid out as a single horizontal row of colour dots + series names inside a
 * rounded, semi-transparent pill. Falls back to vertical layout only when
 * the horizontal row would overflow the plot width. Rendered only with two or
 * more series — one series doesn't need a legend.
 */

import type { SeriesConfig, PlotRect, ResolvedOpts } from '../types.ts';
import { roundedRect } from './shape.ts';

export function renderLegend(
  ctx: CanvasRenderingContext2D,
  configs: readonly SeriesConfig[],
  plot: PlotRect,
  opts: ResolvedOpts,
): void {
  if (configs.length < 2) return;

  const dotR = 4;
  const dotD = dotR * 2;
  const gap = 6;
  const itemGap = 16;
  const padX = 10;
  const padY = 7;
  const cardR = 6;

  ctx.font = `${opts.fontSize}px ${opts.fontFamily}`;

  // Measure each item width: dot + gap + text
  const items: { width: number; config: SeriesConfig }[] = configs.map((c) => ({
    config: c,
    width: dotD + gap + ctx.measureText(c.name).width,
  }));
  const totalW = items.reduce((s, it) => s + it.width + (s > 0 ? itemGap : 0), 0);
  const maxItemW = Math.max(...items.map((it) => it.width));

  // Decide horizontal vs vertical based on available plot width
  const availableW = plot.w - 16; // margin from edges
  const horizontal = totalW <= availableW;

  let cardW: number;
  let cardH: number;

  if (horizontal) {
    cardW = totalW + padX * 2;
    cardH = opts.fontSize + padY * 2;
  } else {
    cardW = maxItemW + padX * 2;
    cardH = items.length * (opts.fontSize + 6) + padY * 2;
  }

  const x = plot.x + plot.w - cardW - 8;
  const y = plot.y + 8;

  // Background
  ctx.fillStyle = 'rgba(10,12,14,0.70)';
  ctx.beginPath();
  roundedRect(ctx, x, y, cardW, cardH, cardR);
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  roundedRect(ctx, x, y, cardW, cardH, cardR);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  if (horizontal) {
    let cx = x + padX;
    for (let i = 0; i < items.length; i++) {
      if (i > 0) cx += itemGap;
      const it = items[i];
      const cy = y + cardH / 2;

      // Dot
      ctx.fillStyle = it.config.color;
      ctx.beginPath();
      ctx.arc(cx + dotR, cy, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Name
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(it.config.name, cx + dotD + gap, cy);

      cx += it.width;
    }
  } else {
    ctx.textBaseline = 'top';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const iy = y + padY + i * (opts.fontSize + 6);

      ctx.fillStyle = it.config.color;
      ctx.beginPath();
      ctx.arc(x + padX + dotR, iy + opts.fontSize / 2, dotR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(it.config.name, x + padX + dotD + gap, iy);
    }
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
