/**
 * @file Numeric label formatting for axis ticks and the crosshair tooltip.
 *
 * Chooses a compact representation by magnitude: integers print without a
 * decimal, very large/small magnitudes switch to exponential, and the middle
 * band keeps a fixed two decimals (or three significant digits below 1).
 */

/** Format a number for display on an axis or in the tooltip. */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toFixed(0);
  const abs = Math.abs(n);
  if ((abs >= 1e6 || (abs <= 1e-4 && abs > 0)) && isFinite(n)) return n.toExponential(2);
  if (abs >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
