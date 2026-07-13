/**
 * @file Tick and label cache: one generateTicks per change, not per frame.
 *
 * The key insight driving this cache is that the *set of tick values*
 * (e.g. [0, 5, 10, 15, 20]) changes far less often than the domain extents
 * that produce them — particularly in the streaming-ring sliding path where
 * `xMin`/`xMax` drift every tick but the grid marks stay identical.
 *
 * {@link refresh} compares the NEWLY-computed tick VALUE SET against the
 * previous one (combined with a format signature). Label strings are cached by
 * tick value, so a sliding window that swaps one tick reformats only that new
 * value while reusing labels for ticks that remain visible.
 *
 * The cache is self-invalidating: any change to formatting options clears the
 * per-value label maps. No manual invalidation is needed at call sites, except
 * `invalidate()` which clears the keys and labels so the next {@link refresh}
 * always recomputes (used on structural/resize paths as a safety net).
 */

import { generateTicks, generateTimeTicks, type TimeTickUnit } from './ticks.ts';
import { formatNumber, formatTimeTick } from './format.ts';
import type { Domain, ResolvedOpts } from '../types.ts';

/** Snapshot of cache keys at a point in time — used to detect drift. */
export interface TickCacheSnapshot {
  xKey: string;
  yLeftKey: string;
  yRightKey: string;
  formatSig: string;
}

/** Pre-resolved X tick values + unit (mirrors module-internal helper). */
function resolveXTicks(d: Domain, opts: ResolvedOpts): { values: number[]; unit?: TimeTickUnit } {
  if (opts.xAxis.type === 'time') return generateTimeTicks(d.xMin, d.xMax, opts.xTicks);
  return { values: generateTicks(d.xMin, d.xMax, opts.xTicks) };
}

/** Pre-resolved X label (mirrors module-internal helper). */
function formatXTick(x: number, unit: TimeTickUnit | undefined, opts: ResolvedOpts): string {
  if (opts.xAxis.tickFormat) return opts.xAxis.tickFormat(x);
  if (opts.xAxis.type === 'time' && unit) return formatTimeTick(x, unit, opts.xAxis.timeZone);
  return formatNumber(x);
}

/** Pre-resolved Y label (mirrors module-internal helper). */
function formatYTick(y: number, opts: ResolvedOpts): string {
  return opts.yAxis.tickFormat ? opts.yAxis.tickFormat(y) : formatNumber(y);
}

/** Identity of formatting options — used as part of cache keys. */
function formatSignature(opts: ResolvedOpts): string {
  const x = opts.xAxis;
  const y = opts.yAxis;
  return [
    x.type ?? 'linear',
    x.timeZone ?? '',
    x.tickFormat?.toString() ?? '',
    y.tickFormat?.toString() ?? '',
    String(opts.xTicks),
    String(opts.yTicks),
  ].join('|');
}

/** Build a cache key from a tick VALUE ARRAY (sorted ascending) + format sig + axis label. */
function tickKey(values: number[], formatSig: string, axis: 'x' | 'yl' | 'yr'): string {
  return values.join(',') + '|' + formatSig + '|' + axis;
}

/**
 * Cache that holds the last-computed tick values, units, and formatted labels.
 *
 * Usage:
 * ```ts
 * const cache = new TickCache();
 *
 * // On every draw, once, before rendering grid/axes:
 * const { xChanged, yLeftChanged, yRightChanged } = cache.refresh(leftDom, rightDom, opts);
 *
 * // Then pass `cache` to renderGrid / renderAxes instead of calling
 * // generateTicks / formatTimeTick directly.
 * ```
 */
export class TickCache {
  // ---- Cached tick values ---------------------------------------------------
  private _xTicks: number[] = [];
  private _xUnit: TimeTickUnit | undefined;
  private _yLeftTicks: number[] = [];
  private _yRightTicks: number[] = [];

  // ---- Cached label strings -------------------------------------------------
  private _xLabels: string[] = [];
  private _yLeftLabels: string[] = [];
  private _yRightLabels: string[] = [];

  /** Per-axis label maps keyed by tick value + relevant unit. Cleared on format changes. */
  private xLabelByTick = new Map<string, string>();
  private yLeftLabelByTick = new Map<string, string>();
  private yRightLabelByTick = new Map<string, string>();

  // ---- Previous keys (empty → first call always misses) ---------------------
  private _lastXKey = '';
  private _lastYLeftKey = '';
  private _lastYRightKey = '';
  private _lastFormatSig = '';

  // ── Public readers (used by renderGrid / renderAxes) ───────────────────────

  get xTicks(): readonly number[] {
    return this._xTicks;
  }
  get xUnit(): TimeTickUnit | undefined {
    return this._xUnit;
  }
  get xLabels(): readonly string[] {
    return this._xLabels;
  }

  get yLeftTicks(): readonly number[] {
    return this._yLeftTicks;
  }
  get yLeftLabels(): readonly string[] {
    return this._yLeftLabels;
  }

  get yRightTicks(): readonly number[] {
    return this._yRightTicks;
  }
  get yRightLabels(): readonly string[] {
    return this._yRightLabels;
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  /**
   * Recompute ticks and labels for the current domains. Returns which axes
   * actually changed tick sets since the last call.
   *
   * @param left  - The left-axis domain (always available).
   * @param right - The right-axis domain, or `null` when dual-Y is inactive.
   * @param opts  - Resolved chart options (tick count, format, type, etc.).
   */
  refresh(
    left: Domain,
    right: Domain | null,
    opts: ResolvedOpts,
  ): { xChanged: boolean; yLeftChanged: boolean; yRightChanged: boolean } {
    const fmtSig = formatSignature(opts);

    if (fmtSig !== this._lastFormatSig) {
      this.xLabelByTick.clear();
      this.yLeftLabelByTick.clear();
      this.yRightLabelByTick.clear();
    }

    // --- X ticks ---
    const { values: xTicks, unit: xUnit } = resolveXTicks(left, opts);
    const xKey = tickKey(xTicks, fmtSig, 'x');
    const xChanged = xKey !== this._lastXKey || fmtSig !== this._lastFormatSig;

    // --- Y left ticks ---
    const yLeftTicks = generateTicks(left.yMin, left.yMax, opts.yTicks);
    const yLeftKey = tickKey(yLeftTicks, fmtSig, 'yl');
    const yLeftChanged = yLeftKey !== this._lastYLeftKey || fmtSig !== this._lastFormatSig;

    // --- Y right ticks (if applicable) ---
    let yRightChanged = false;
    let yRightTicks: number[] = [];
    if (right) {
      yRightTicks = generateTicks(right.yMin, right.yMax, opts.yTicks);
      const yRightKey = tickKey(yRightTicks, fmtSig, 'yr');
      yRightChanged = yRightKey !== this._lastYRightKey || fmtSig !== this._lastFormatSig;
    }

    // --- Populate labels. Even when the tick set changes, unchanged tick
    // values reuse their previous label; only newly-visible ticks format.
    if (xChanged) this._xLabels = xTicks.map((v) => this.labelForXTick(v, xUnit, opts));
    if (yLeftChanged) this._yLeftLabels = yLeftTicks.map((v) => this.labelForYTick(v, opts, this.yLeftLabelByTick));
    if (right && yRightChanged) {
      this._yRightLabels = yRightTicks.map((v) => this.labelForYTick(v, opts, this.yRightLabelByTick));
    }

    // --- Store ---
    this._xTicks = xTicks;
    this._xUnit = xUnit;
    this._yLeftTicks = yLeftTicks;
    this._yRightTicks = yRightTicks;
    this._lastXKey = xKey;
    this._lastYLeftKey = yLeftKey;
    this._lastYRightKey = right ? tickKey(yRightTicks, fmtSig, 'yr') : '';
    this._lastFormatSig = fmtSig;

    return { xChanged, yLeftChanged, yRightChanged };
  }

  // ── Snapshot / drift detection ─────────────────────────────────────────────

  /** Capture the current keys — used before a mutation to detect changes. */
  snapshotKeys(): TickCacheSnapshot {
    return {
      xKey: this._lastXKey,
      yLeftKey: this._lastYLeftKey,
      yRightKey: this._lastYRightKey,
      formatSig: this._lastFormatSig,
    };
  }

  /** True when any key changed compared to `before`. */
  keysChanged(before: TickCacheSnapshot): boolean {
    return (
      this._lastXKey !== before.xKey ||
      this._lastYLeftKey !== before.yLeftKey ||
      this._lastYRightKey !== before.yRightKey ||
      this._lastFormatSig !== before.formatSig
    );
  }

  /** Force a full recompute on the next refresh. */
  invalidate(): void {
    this._lastXKey = '';
    this._lastYLeftKey = '';
    this._lastYRightKey = '';
    this._lastFormatSig = '';
    this.xLabelByTick.clear();
    this.yLeftLabelByTick.clear();
    this.yRightLabelByTick.clear();
  }

  private labelForXTick(value: number, unit: TimeTickUnit | undefined, opts: ResolvedOpts): string {
    const key = `${value}|${unit ?? ''}`;
    const cached = this.xLabelByTick.get(key);
    if (cached !== undefined) return cached;
    const label = formatXTick(value, unit, opts);
    this.xLabelByTick.set(key, label);
    return label;
  }

  private labelForYTick(value: number, opts: ResolvedOpts, labels: Map<string, string>): string {
    const key = String(value);
    const cached = labels.get(key);
    if (cached !== undefined) return cached;
    const label = formatYTick(value, opts);
    labels.set(key, label);
    return label;
  }
}
