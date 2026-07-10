/**
 * @file Visible-window resolution for renderers.
 *
 * When the view's domain (`xMin`/`xMax`) is narrower than the actual sample
 * extent — the v1.7.0 zoom/viewport case — iterating over every sample is
 * pure waste: samples outside the domain map to pixels outside the plot rect
 * and are then clipped away. This helper binary-searches the SeriesView's
 * logical index to bracket the visible range, so renderers can iterate only
 * the samples that can contribute to a pixel column.
 *
 * The window is inclusive of one extra sample on each side of the domain, so
 * the polyline/decimation loop still has a valid neighbour to draw the entry
 * and exit segments that straddle the plot edges. When the entire domain
 * lies outside the sample extent the window collapses to an empty range.
 */

import type { SeriesView } from '../types.ts';

/**
 * Iteration window over `view` restricted to `[xMin, xMax]`, in the same
 * logical/physical index scheme every renderer already uses. Consumers walk
 * `for (let i = iStart; i <= iEnd; i++)`, starting from physical slot
 * `pStart` with `toWrapStart` steps left before wrapping — the same pattern
 * as the pre-windowed loops, just with tighter bounds.
 */
export interface RenderWindow {
  /** First logical index to render (inclusive). */
  iStart: number;
  /** Last logical index to render (inclusive). May be `< iStart` when empty. */
  iEnd: number;
  /** Physical slot corresponding to `iStart`. */
  pStart: number;
  /** Steps left before the physical cursor wraps from `cap-1` back to `0`. */
  toWrapStart: number;
}

/**
 * Resolve the logical iteration window for `view` restricted to
 * `[xMin, xMax]`. Uses the view's own `bracketLogical` (O(log n)) so wrapped
 * ring storage is handled without extra work. Always includes one extra
 * sample on each side of the range — the entry/exit segments of a polyline
 * need a neighbour outside the visible domain to slope correctly into the
 * plot edge.
 *
 * When `count` is zero or the domain has zero width the window is returned
 * empty (`iEnd < iStart`); renderers should treat that as "nothing to draw".
 */
export function resolveRenderWindow(view: SeriesView, xMin: number, xMax: number): RenderWindow {
  const n = view.count;
  const empty: RenderWindow = { iStart: 0, iEnd: -1, pStart: view.head, toWrapStart: view.cap - view.head };
  if (n === 0) return empty;

  // Full-range fallback: iterate the entire logical window from the head.
  // Used when the domain is zero-width or non-finite (degenerate 1-sample
  // series, empty domain from an all-NaN series, etc.), where windowing
  // isn't meaningful but the caller still expects the series to render.
  const full = (): RenderWindow => ({ iStart: 0, iEnd: n - 1, pStart: view.head, toWrapStart: view.cap - view.head });
  if (!(xMax > xMin) || !Number.isFinite(xMin) || !Number.isFinite(xMax)) return full();

  // bracketLogical returns the largest logical index whose x ≤ target,
  // clamped to [0, n-1]. That's exactly the "left neighbour" for xMin and
  // the "right anchor" for xMax; extend by 1 on each side so the polyline
  // has enough context to draw entry/exit segments.
  let iStart = view.bracketLogical(xMin);
  let iEnd = view.bracketLogical(xMax) + 1;
  if (iStart > 0) iStart -= 1;
  if (iEnd > n - 1) iEnd = n - 1;
  if (iStart > iEnd) return empty;

  const pStart = view.physOf(iStart);
  const toWrapStart = view.cap - pStart;
  return { iStart, iEnd, pStart, toWrapStart };
}
