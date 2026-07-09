/**
 * @file Data-space ↔ pixel-space coordinate transforms.
 *
 * Exposes `xToPx` / `pxToX` / `yToPx` for the three scale types envisioned by
 * the library architecture:
 *
 * - **`'linear'`** — the original continuous math (default).
 * - **`'time'`** — epoch-ms **is** linear on the number line, so the same
 *   arithmetic applies; the time-awareness lives in **tick generation**
 *   (`generateTimeTicks` in `ticks.ts`) and **formatting** (`formatTimeTick`
 *   in `format.ts`), not in the coordinate transform.
 * - **`'band'`** — reserved for the v1.9.0 bar chart. The parameter is
 *   accepted and propagated now; a descriptive error is thrown at runtime
 *   until the implementation lands.
 *
 * Used outside the line hot loop (ticks, crosshair); the line renderer
 * inlines its own arithmetic for per-point speed. A zero-width range
 * degenerates to the plot origin rather than dividing by zero.
 */

import type { Domain, PlotRect, ScaleType } from '../types.ts';

/**
 * Map a data x value to a horizontal pixel coordinate.
 * @param x - Data-space x value
 * @param d - Data domain (xMin, xMax)
 * @param plot - Plot rectangle in CSS pixels
 * @param scaleType - Scale type (default `'linear'`). `'time'` uses the same
 *   linear math (epoch-ms is continuous). `'band'` throws until v1.9.0.
 * @returns Pixel x-coordinate (CSS pixels)
 */
export function xToPx(x: number, d: Domain, plot: PlotRect, scaleType?: ScaleType): number {
  if (scaleType === 'band') {
    throw new Error('[goro-charts] band scale is not implemented until v1.9.0');
  }
  // linear & time: epoch-ms is numerically linear, so the same arithmetic applies
  const range = d.xMax - d.xMin;
  if (range <= 0) return plot.x;
  return plot.x + ((x - d.xMin) / range) * plot.w;
}

/**
 * Map a data y value to a vertical pixel coordinate (y grows downward).
 * @param y - Data-space y value
 * @param d - Data domain (yMin, yMax)
 * @param plot - Plot rectangle in CSS pixels
 * @returns Pixel y-coordinate (CSS pixels)
 */
export function yToPx(y: number, d: Domain, plot: PlotRect): number {
  const range = d.yMax - d.yMin;
  if (range <= 0) return plot.y;
  return plot.y + (1 - (y - d.yMin) / range) * plot.h;
}

/**
 * Map a horizontal pixel coordinate back to a data x value.
 * @param px - Pixel x-coordinate (CSS pixels)
 * @param d - Data domain (xMin, xMax)
 * @param plot - Plot rectangle in CSS pixels
 * @param scaleType - Scale type (default `'linear'`). `'band'` throws until v1.9.0.
 * @returns Data-space x value
 */
export function pxToX(px: number, d: Domain, plot: PlotRect, scaleType?: ScaleType): number {
  if (scaleType === 'band') {
    throw new Error('[goro-charts] band scale is not implemented until v1.9.0');
  }
  const range = d.xMax - d.xMin;
  if (range <= 0) return d.xMin;
  return d.xMin + ((px - plot.x) / plot.w) * range;
}
