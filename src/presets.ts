/**
 * @file Ready-to-use colour presets for quick theming.
 *
 * Spread over any chart's constructor options to override colours without
 * assembling every value manually.
 *
 * Usage:
 * ```ts
 * import { LineChart, DARK } from 'goro-charts'
 * new LineChart(canvas, { ...DARK, series: [...] })
 * ```
 */

import type { ChartOpts } from './types.ts';

/** Dark theme preset. */
export const DARK: ChartOpts = {
  gridColor: 'rgba(255,255,255,0.08)',
  axisColor: 'rgba(255,255,255,0.25)',
  textColor: 'rgba(255,255,255,0.5)',
  crosshairColor: 'rgba(255,255,255,0.3)',
  pointColor: '#4ea8ff',
  bgColor: '#111',
};

/** Light theme preset. */
export const LIGHT: ChartOpts = {
  gridColor: 'rgba(0,0,0,0.08)',
  axisColor: 'rgba(0,0,0,0.18)',
  textColor: 'rgba(0,0,0,0.55)',
  crosshairColor: 'rgba(0,0,0,0.18)',
  pointColor: '#2563eb',
  bgColor: '#fff',
};
