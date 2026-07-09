/**
 * @file Axis tick generation.
 *
 * Produces "nice" round tick values for an axis given a data range and a
 * target tick count. Spacing is snapped to 1, 2, or 5 times a power of ten so
 * labels read cleanly (…, 10, 20, 50, 100, …) instead of arbitrary fractions.
 *
 * {@link generateTimeTicks} is the calendar-aware counterpart used by the
 * `xAxis.type: 'time'` scale (v1.6.0): instead of continuous 1/2/5×10ⁿ
 * spacing it snaps to a discrete table of calendar-sensible steps
 * (millisecond → year) and, for month/year steps, walks real `Date`
 * boundaries (via UTC, for deterministic output independent of host time
 * zone) instead of adding a fixed millisecond stride — months and years
 * don't have constant length, so a fixed-ms stride would drift.
 */

/** Range guard: a zero-width range collapses to 1 so tick math stays finite. */
function niceRange(min: number, max: number): number {
  const r = max - min;
  return r === 0 ? 1 : r;
}

/**
 * Snap a raw per-tick spacing to the nearest "nice" value (1, 2, 5 × 10^exp).
 * @param range total data range
 * @param maxTicks approximate desired number of ticks
 */
function niceSpacing(range: number, maxTicks: number): number {
  const exp = Math.floor(Math.log10(range / maxTicks));
  const frac = range / maxTicks / Math.pow(10, exp);
  let nice: number;
  if (frac <= 1.5) nice = 1;
  else if (frac <= 3.5) nice = 2;
  else if (frac <= 7.5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

/**
 * Generate the list of tick values spanning [min, max] at a nice spacing.
 * Spacing is snapped to 1, 2, or 5 × 10ⁿ so labels read cleanly.
 * @param min - Lower bound of the data range
 * @param max - Upper bound of the data range
 * @param maxTicks - Approximate desired number of ticks (actual count varies)
 * @returns Array of tick values sorted ascending
 */
export function generateTicks(min: number, max: number, maxTicks: number): number[] {
  const spacing = niceSpacing(niceRange(min, max), maxTicks);
  const start = Math.ceil(min / spacing) * spacing;
  const end = Math.floor(max / spacing) * spacing;
  const ticks: number[] = [];
  for (let v = start; v <= end + spacing * 0.5; v += spacing) {
    ticks.push(v);
  }
  return ticks;
}

/** Calendar granularity a {@link generateTimeTicks} step was snapped to. */
export type TimeTickUnit = 'ms' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Fixed-millisecond step tiers, tried from finest to coarsest. */
const MS_TIERS: { unit: TimeTickUnit; steps: number[]; msPerStep: number }[] = [
  { unit: 'ms', steps: [1, 2, 5, 10, 20, 50, 100, 200, 500], msPerStep: 1 },
  { unit: 'second', steps: [1, 2, 5, 10, 15, 30], msPerStep: 1000 },
  { unit: 'minute', steps: [1, 2, 5, 10, 15, 30], msPerStep: 60_000 },
  { unit: 'hour', steps: [1, 2, 3, 6, 12], msPerStep: 3_600_000 },
  { unit: 'day', steps: [1, 2, 3, 7], msPerStep: 86_400_000 }, // step 7 reports as 'week'
];

/** Average month/year length in ms — only used to pick a calendar tier's step, never to place a tick. */
const APPROX_MONTH_MS = 2_629_746_000; // 30.4368 days
const APPROX_YEAR_MS = 31_556_952_000; // 365.2425 days

const MONTH_STEPS = [1, 2, 3, 6];
const YEAR_STEPS = [1, 2, 5, 10, 25, 50, 100];

/** Safety cap on generated ticks so a pathological domain can't loop unbounded. */
const MAX_TIME_TICKS = 10_000;

/** Fixed-ms tier: same ceil/floor snapping as {@link generateTicks}, just in absolute ms. */
function fixedStepTicks(min: number, max: number, stepMs: number): number[] {
  const start = Math.ceil(min / stepMs) * stepMs;
  const end = Math.floor(max / stepMs) * stepMs;
  const ticks: number[] = [];
  for (let v = start, i = 0; v <= end + stepMs * 0.5 && i < MAX_TIME_TICKS; v += stepMs, i++) {
    ticks.push(v);
  }
  return ticks;
}

/**
 * Month-boundary ticks, `stepMonths` apart, aligned to multiples of
 * `stepMonths` counted from the Unix epoch month (Jan 1970) — e.g. step 3
 * lands on Jan/Apr/Jul/Oct. Walked via UTC `Date` fields (not a fixed ms
 * stride) so variable month length never drifts the boundary.
 */
function monthTicks(min: number, max: number, stepMonths: number): number[] {
  const minD = new Date(min);
  let totalMonths = Math.ceil((minD.getUTCFullYear() * 12 + minD.getUTCMonth()) / stepMonths) * stepMonths;
  const values: number[] = [];
  for (let i = 0; i < MAX_TIME_TICKS; i++, totalMonths += stepMonths) {
    const y = Math.floor(totalMonths / 12);
    const m = totalMonths % 12;
    const t = Date.UTC(y, m, 1);
    if (t > max) break;
    if (t >= min) values.push(t);
  }
  return values;
}

/** Year-boundary (Jan 1) ticks, `stepYears` apart, aligned to multiples of `stepYears`. */
function yearTicks(min: number, max: number, stepYears: number): number[] {
  const minY = new Date(min).getUTCFullYear();
  const startY = Math.ceil(minY / stepYears) * stepYears;
  const values: number[] = [];
  for (let i = 0; i < MAX_TIME_TICKS; i++) {
    const t = Date.UTC(startY + i * stepYears, 0, 1);
    if (t > max) break;
    if (t >= min) values.push(t);
  }
  return values;
}

/**
 * Generate calendar-aware ticks for a `time`-scaled axis spanning
 * `[min, max]` (epoch milliseconds), targeting roughly `maxTicks` ticks.
 *
 * Tries fixed-ms tiers first (ms → second → minute → hour → day/week); once
 * the target spacing exceeds a week it switches to calendar-walked
 * month/quarter/year steps so labels land on real calendar boundaries
 * instead of drifting fixed-ms multiples.
 *
 * @param min - Lower bound of the time domain (epoch ms)
 * @param max - Upper bound of the time domain (epoch ms)
 * @param maxTicks - Approximate desired number of ticks (actual count varies)
 * @returns Tick values sorted ascending, plus the granularity they were snapped to
 */
export function generateTimeTicks(
  min: number,
  max: number,
  maxTicks: number,
): { values: number[]; unit: TimeTickUnit } {
  if (!(max > min)) {
    return { values: [min], unit: 'second' };
  }

  const targetStep = (max - min) / Math.max(1, maxTicks);

  for (const tier of MS_TIERS) {
    for (const step of tier.steps) {
      const stepMs = step * tier.msPerStep;
      if (stepMs >= targetStep) {
        const unit: TimeTickUnit = tier.unit === 'day' && step === 7 ? 'week' : tier.unit;
        return { values: fixedStepTicks(min, max, stepMs), unit };
      }
    }
  }

  for (const step of MONTH_STEPS) {
    if (step * APPROX_MONTH_MS >= targetStep) {
      return { values: monthTicks(min, max, step), unit: step === 3 ? 'quarter' : 'month' };
    }
  }

  for (const step of YEAR_STEPS) {
    if (step * APPROX_YEAR_MS >= targetStep) {
      return { values: yearTicks(min, max, step), unit: 'year' };
    }
  }

  // Extremely large range: fall back to the coarsest year step available.
  return { values: yearTicks(min, max, YEAR_STEPS[YEAR_STEPS.length - 1]), unit: 'year' };
}
