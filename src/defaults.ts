/**
 * @file Default options merged over any user-supplied {@link ChartOpts}.
 *
 * The top-level colour / width fields are per-series fallbacks — each series
 * config entry provides its own colour and optional overrides. `maxPoints: 0`
 * is a sentinel meaning "snapshot mode" (no ring); the constructor activates
 * ring mode only when the user passes a positive value.
 *
 * `yMin: 0 / yMax: 0` are sentinels meaning "auto" — the grid domain
 * expands from data unless the user sets non-zero values.
 */

import type { ResolvedOpts } from './types.ts'

export const CHART_DEFAULTS: ResolvedOpts = {
  series: [{ name: 'Series 0', color: '#4ea8ff', lineWidth: 1.5 }],
  padding: [16, 16, 32, 56],
  lineColor: '#4ea8ff',
  lineWidth: 1.5,
  fillColor: '#4ea8ff',
  fillOpacity: 0.15,
  pointColor: '#4ea8ff',
  gridColor: 'rgba(255,255,255,0.08)',
  axisColor: 'rgba(255,255,255,0.25)',
  textColor: 'rgba(255,255,255,0.5)',
  fontSize: 11,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  crosshairColor: 'rgba(255,255,255,0.3)',
  crosshairWidth: 1,
  pointRadius: 4,
  bgColor: '#111',
  xTicks: 8,
  yTicks: 6,
  maxPoints: 0,
  autoDraw: false,
  yMin: 0,
  yMax: 0,
  maxDots: 2000,
}
