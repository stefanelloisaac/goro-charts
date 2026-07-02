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
import type { SeriesView } from '../types.ts';

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

  /** Create the ring up front (used when constructed with maxPoints). */
  initRing(maxPoints: number): void {
    if (maxPoints < 1) throw new Error('maxPoints must be >= 1');
    this.ring = new RingBuffer(maxPoints);
    this.bindRing();
  }

  /**
   * Snapshot mode: replace the whole series. Extents computed once in O(n).
   * Disables any active ring mode.
   */
  setData(x: Float64Array<ArrayBufferLike>, y: Float64Array<ArrayBufferLike>): void {
    if (x.length !== y.length) throw new Error('x and y must have same length');
    if (x.length === 0) throw new Error('data arrays must not be empty');

    this.ring = null;
    this.xArr = x;
    this.yArr = y;
    this.head = 0;
    this.count = x.length;
    this.cap = x.length;

    this.xMin = x[0];
    this.xMax = x[x.length - 1];

    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
    this.applyExtent(yMin, yMax);
  }

  /** Ring mode: append one sample (x must be monotonically increasing). */
  append(x: number, y: number): void {
    const r = this.requireRing('append');
    r.push(x, y);
    this.syncFromRing();
  }

  /** Ring mode: append a batch of parallel samples. O(k). */
  appendBatch(xs: ArrayLike<number>, ys: ArrayLike<number>): void {
    const r = this.requireRing('appendBatch');
    if (xs.length !== ys.length) throw new Error('xs and ys must have same length');
    for (let i = 0; i < xs.length; i++) r.push(xs[i], ys[i]);
    this.syncFromRing();
  }

  /** Resize the streaming window, keeping the most recent samples. */
  setMaxPoints(maxPoints: number): void {
    if (maxPoints < 1) throw new Error('maxPoints must be >= 1');
    if (!this.ring) this.ring = new RingBuffer(maxPoints);
    else this.ring.resize(maxPoints);
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
