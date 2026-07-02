/**
 * @file Small number formatter shared across demo UI modules.
 */

/** Locale-aware fixed-digit formatter. */
export function fmt(n: number, digits = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
