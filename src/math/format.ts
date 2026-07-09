/**
 * @file Numeric and time label formatting for axis ticks and the crosshair
 * tooltip.
 *
 * `formatNumber` chooses a compact representation by magnitude: integers
 * print without a decimal, very large/small magnitudes switch to
 * exponential, and the middle band keeps a fixed two decimals (or three
 * significant digits below 1).
 *
 * `formatTimeTick` is the default label for a `xAxis.type: 'time'` axis
 * (v1.6.0): the display grain matches the tick's own calendar unit (from
 * {@link generateTimeTicks}) instead of guessing per-value, which is what
 * keeps time labels non-overlapping and coherent across a redraw.
 */

import type { TimeTickUnit } from './ticks.ts';

/**
 * Format a number for display on an axis or in the tooltip.
 * Integers print without decimal; very large/small magnitudes switch to
 * exponential notation; values between 1e-4 and 1 use toPrecision(3);
 * everything else uses toFixed(2).
 * @param n - Number to format
 * @returns Formatted string suitable for axis labels and tooltips
 */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toFixed(0);
  const abs = Math.abs(n);
  if ((abs >= 1e6 || (abs <= 1e-4 && abs > 0)) && isFinite(n)) return n.toExponential(2);
  if (abs >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

/** `Intl.DateTimeFormat` options per calendar granularity, coarsest-appropriate first. */
function unitToIntlOptions(unit: TimeTickUnit): Intl.DateTimeFormatOptions {
  switch (unit) {
    case 'ms':
    case 'second':
      return { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
    case 'minute':
    case 'hour':
      return { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    case 'day':
    case 'week':
      return { month: 'short', day: 'numeric' };
    case 'month':
    case 'quarter':
      return { month: 'short', year: 'numeric' };
    case 'year':
      return { year: 'numeric' };
  }
}

/**
 * Format an epoch-ms timestamp for display on a time axis or in the
 * tooltip, at the grain implied by `unit` (typically the `unit` returned
 * alongside the tick values by {@link generateTimeTicks}).
 *
 * `timeZone` only affects this built-in formatter — it is forwarded as-is
 * to `Intl.DateTimeFormat`. Callers supplying `xAxis.tickFormat` bypass this
 * function entirely and are responsible for their own time zone handling.
 *
 * @param ms - Epoch milliseconds
 * @param unit - Calendar granularity to format at
 * @param timeZone - Optional IANA time zone (default: host time zone)
 * @returns Formatted string suitable for a time-axis label or tooltip row
 */
export function formatTimeTick(ms: number, unit: TimeTickUnit, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, ...unitToIntlOptions(unit) }).format(ms);
}
