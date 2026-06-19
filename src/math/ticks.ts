/**
 * @file Axis tick generation.
 *
 * Produces "nice" round tick values for an axis given a data range and a
 * target tick count. Spacing is snapped to 1, 2, or 5 times a power of ten so
 * labels read cleanly (…, 10, 20, 50, 100, …) instead of arbitrary fractions.
 */

/** Range guard: a zero-width range collapses to 1 so tick math stays finite. */
function niceRange(min: number, max: number): number {
  const r = max - min
  return r === 0 ? 1 : r
}

/**
 * Snap a raw per-tick spacing to the nearest "nice" value (1, 2, 5 × 10^exp).
 * @param range total data range
 * @param maxTicks approximate desired number of ticks
 */
function niceSpacing(range: number, maxTicks: number): number {
  const exp = Math.floor(Math.log10(range / maxTicks))
  const frac = range / maxTicks / Math.pow(10, exp)
  let nice: number
  if (frac <= 1.5) nice = 1
  else if (frac <= 3.5) nice = 2
  else if (frac <= 7.5) nice = 5
  else nice = 10
  return nice * Math.pow(10, exp)
}

/**
 * Generate the list of tick values spanning [min, max] at a nice spacing.
 * @param maxTicks approximate desired number of ticks (actual count varies)
 */
export function generateTicks(min: number, max: number, maxTicks: number): number[] {
  const spacing = niceSpacing(niceRange(min, max), maxTicks)
  const start = Math.ceil(min / spacing) * spacing
  const end = Math.floor(max / spacing) * spacing
  const ticks: number[] = []
  for (let v = start; v <= end + spacing * 0.5; v += spacing) {
    ticks.push(v)
  }
  return ticks
}
