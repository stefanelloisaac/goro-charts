/**
 * @file Linear data-space ↔ pixel-space coordinate transforms.
 *
 * Maps a data value onto the plot rectangle and back. Used outside the line
 * hot loop (ticks, crosshair); the line renderer inlines the same arithmetic
 * for per-point speed. A zero-width range degenerates to the plot origin
 * rather than dividing by zero.
 */

import type { Domain, PlotRect } from '../types.ts';

/**
 * Map a data x value to a horizontal pixel coordinate.
 * @param x - Data-space x value
 * @param d - Data domain (xMin, xMax)
 * @param plot - Plot rectangle in CSS pixels
 * @returns Pixel x-coordinate (CSS pixels)
 */
export function xToPx(x: number, d: Domain, plot: PlotRect): number {
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
 * @returns Data-space x value
 */
export function pxToX(px: number, d: Domain, plot: PlotRect): number {
  const range = d.xMax - d.xMin;
  if (range <= 0) return d.xMin;
  return d.xMin + ((px - plot.x) / plot.w) * range;
}
