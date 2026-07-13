/**
 * @file Unified data model behind both chart modes, implementing SeriesView.
 *
 * Snapshot mode (setData) holds caller-owned arrays directly with head=0.
 * Ring mode (append/appendBatch) delegates storage to a {@link RingBuffer} and
 * mirrors its O(1) cached geometry into local fields each tick. Either way the
 * store exposes the same logical window `[0, count)` plus `physOf` /
 * `bracketLogical` addressing, so renderers consume one stable contract.
 *
 * The store is purely about data: it never touches the canvas or scheduling.
 */

import { RingBuffer } from './ring-buffer.ts';
import type { SeriesView, DataOwnership } from '../types.ts';

/** Owns the series data and computes/caches its extents. */
export class SeriesStore implements SeriesView {
  xArr: Float64Array<ArrayBufferLike> = new Float64Array();
  yArr: Float64Array<ArrayBufferLike> = new Float64Array();
  head = 0;
  count = 0;
  cap = 0;
  xMin = 0;
  xMax = 0;
  yMin = 0;
  yMax = 0;

  private ring: RingBuffer | null = null;

  /** Whether ring (streaming) mode is active. */
  get isRing(): boolean {
    return this.ring !== null;
  }

  /**
   * Create the ring up front (used when constructed with maxPoints).
   * @throws {Error} if maxPoints < 1
   */
  initRing(maxPoints: number): void {
    if (maxPoints < 1) throw new Error('maxPoints must be >= 1');
    this.ring = new RingBuffer(maxPoints);
    this.bindRing();
  }

  /**
   * Snapshot mode: replace the whole series. Extents computed once in O(n).
   * Disables any active ring mode.
   *
   * By default (`ownership: 'copy'`) the store copies the caller's arrays into
   * fresh buffers — the caller may mutate the originals freely after the call.
   * Pass `'borrowed'` to keep the caller's arrays by reference (must be treated
   * as immutable for as long as the chart holds them).
   *
   * @throws {Error} if x and y have different lengths
   * @throws {Error} if x is empty
   * @throws {Error} if any x value is not finite, or x is not monotonically increasing
   * @throws {Error} if any y value is not finite (NaN in Y is allowed — reserved for gaps v1.6.0)
   */
  setData(x: Float64Array<ArrayBufferLike>, y: Float64Array<ArrayBufferLike>, ownership: DataOwnership = 'copy'): void {
    this.validateSnapshot(x, y);

    this.ring = null;
    this.xArr = ownership === 'copy' ? new Float64Array(x) : x;
    this.yArr = ownership === 'copy' ? new Float64Array(y) : y;
    this.head = 0;
    this.count = x.length;
    this.cap = x.length;

    this.xMin = x[0];
    this.xMax = x[x.length - 1];

    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      if (Number.isNaN(v)) continue; // reserved for gap rendering (v1.6.0)
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
    if (yMin === Infinity) {
      // all Y values were NaN — degenerate safe range
      yMin = 0;
      yMax = 0;
    }
    this.applyExtent(yMin, yMax);
  }

  /**
   * Ring mode: append one sample (x must be monotonically increasing).
   * @throws {Error} if ring mode is not active (maxPoints not set)
   * @throws {Error} if x is not finite
   * @throws {Error} if x is < last x (not monotonically increasing)
   * @throws {Error} if y is not finite (NaN in Y is allowed — reserved for gaps v1.6.0)
   */
  append(x: number, y: number): void {
    const r = this.requireRing('append');
    if (!Number.isFinite(x)) {
      throw new Error(`append x=${x} is not finite`);
    }
    if (r.count > 0 && x < r.xLast) {
      throw new Error(`append x=${x} is < last x=${r.xLast}; x must be monotonically increasing`);
    }
    if (!isFiniteOrNaN(y)) {
      throw new Error(`append y=${y} is not finite`);
    }
    r.push(x, y);
    this.syncFromRing();
  }

  /**
   * Ring mode: append a batch of parallel samples. O(k).
   *
   * The entire batch is validated before any sample is pushed, so a partial
   * batch never corrupts the ring.
   *
   * @throws {Error} if ring mode is not active
   * @throws {Error} if xs and ys have different lengths
   * @throws {Error} if any x is not finite, or xs are not monotonically increasing
   * @throws {Error} if any y is not finite (NaN in Y is allowed — reserved for gaps v1.6.0)
   */
  appendBatch(xs: ArrayLike<number>, ys: ArrayLike<number>): void {
    const r = this.requireRing('appendBatch');
    if (xs.length !== ys.length) throw new Error('xs and ys must have same length');

    // Validate the entire batch before touching ring state, so a rejected
    // batch never leaves the ring half-updated.
    const k = xs.length;
    if (k === 0) return;
    for (let i = 0; i < k; i++) {
      if (!Number.isFinite(xs[i])) {
        throw new Error(`xs[${i}]=${xs[i]} is not finite`);
      }
      if (i > 0 && xs[i] < xs[i - 1]) {
        throw new Error(
          `xs not monotonically increasing at batch index ${i}: xs[${i}]=${xs[i]} < xs[${i - 1}]=${xs[i - 1]}`,
        );
      }
      if (!isFiniteOrNaN(ys[i])) {
        throw new Error(`ys[${i}]=${ys[i]} is not finite`);
      }
    }

    for (let i = 0; i < k; i++) r.push(xs[i], ys[i]);
    this.syncFromRing();
  }

  /** Resize the streaming window, keeping the most recent samples. */
  setMaxPoints(maxPoints: number): void {
    if (maxPoints < 1) throw new Error('maxPoints must be >= 1');
    if (!this.ring) {
      this.ring = new RingBuffer(maxPoints);
    } else {
      this.ring.resize(maxPoints);
    }
    this.bindRing();
    this.syncFromRing();
  }

  /** Empty the current data (works in both modes). */
  clear(): void {
    if (this.ring) {
      this.ring.clear();
      this.syncFromRing();
    } else {
      this.head = this.count = this.cap = 0;
      this.xArr = new Float64Array();
      this.yArr = new Float64Array();
    }
  }

  /** Most recent y value, or NaN if empty. */
  get lastValue(): number {
    if (this.count === 0) return NaN;
    return this.yArr[this.physOf(this.count - 1)];
  }

  physOf(logical: number): number {
    const p = this.head + logical;
    return p >= this.cap ? p - this.cap : p;
  }

  bracketLogical(target: number): number {
    const n = this.count;
    let lo = 0;
    let hi = n - 1;
    if (target <= this.xArr[this.physOf(0)]) return 0;
    if (target >= this.xArr[this.physOf(hi)]) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.xArr[this.physOf(mid)] <= target) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Validate snapshot data before accepting it into the store.
   * Checks length, non-empty, finite + monotonic X, and finite Y.
   * @throws {Error} with position-aware message on any violation.
   */
  private validateSnapshot(x: Float64Array<ArrayBufferLike>, y: Float64Array<ArrayBufferLike>): void {
    if (x.length !== y.length) {
      throw new Error(`x and y length mismatch: x.length=${x.length}, y.length=${y.length}`);
    }
    if (x.length === 0) throw new Error('data arrays must not be empty');

    if (!Number.isFinite(x[0])) {
      throw new Error(`x[0]=${x[0]} is not finite`);
    }
    for (let i = 1; i < x.length; i++) {
      if (!Number.isFinite(x[i])) {
        throw new Error(`x[${i}]=${x[i]} is not finite`);
      }
      if (x[i] < x[i - 1]) {
        throw new Error(`x not monotonically increasing at index ${i}: x[${i}]=${x[i]} < x[${i - 1}]=${x[i - 1]}`);
      }
    }

    for (let i = 0; i < y.length; i++) {
      if (!isFiniteOrNaN(y[i])) {
        throw new Error(`y[${i}]=${y[i]} is not finite`);
      }
    }
  }

  private requireRing(method: string): RingBuffer {
    if (!this.ring) {
      throw new Error(`${method}() requires the chart to be created with { maxPoints }`);
    }
    return this.ring;
  }

  /** Point the store's logical window at the ring's physical storage. */
  private bindRing(): void {
    const r = this.ring!;
    this.xArr = r.x;
    this.yArr = r.y;
  }

  /** Mirror the ring's O(1) cached geometry into the store's fields. */
  private syncFromRing(): void {
    const r = this.ring!;
    if (this.xArr !== r.x) this.bindRing();
    this.head = r.head;
    this.count = r.count;
    this.cap = r.cap;
    if (r.count > 0) {
      this.xMin = r.xFirst;
      this.xMax = r.xLast;
      this.applyExtent(r.yMin, r.yMax);
    }
  }

  /** Store y-extent, expanding a degenerate (flat) range so the line shows. */
  private applyExtent(yMin: number, yMax: number): void {
    if (yMax - yMin === 0) {
      this.yMin = yMin - 1;
      this.yMax = yMax + 1;
    } else {
      this.yMin = yMin;
      this.yMax = yMax;
    }
  }
}

/**
 * The Y contract, shared by snapshot and ring paths: a Y value is accepted iff
 * it is finite or `NaN`. `NaN` is a deliberate sentinel reserved for gap
 * rendering (v1.6.0) and is excluded from the extent; `±Infinity` is rejected
 * because it would silently corrupt the min/max scale.
 */
function isFiniteOrNaN(v: number): boolean {
  return Number.isFinite(v) || Number.isNaN(v);
}
