/**
 * @file Sliding-window min & max in O(1) amortized per push.
 *
 * Maintains two monotonic deques backed by circular Float64Arrays (no object
 * allocation): the min-deque is strictly increasing front→back, the max-deque
 * strictly decreasing, so each window extreme sits at its deque's front.
 *
 * Each push runs three steps in the canonical order — evict expired from
 * front, pop dominated from back, append — which is what guarantees a deque
 * never exceeds capacity. `seq` is a globally increasing sample id and
 * `windowStart` is the oldest seq still inside the window; an entry expires
 * once its seq < windowStart.
 */

/** Incremental sliding-window extent tracker. */
export class MonotonicExtent {
  private cap: number;
  private vMin: Float64Array;
  private sMin: Float64Array;
  private hMin = 0;
  private nMin = 0;
  private vMax: Float64Array;
  private sMax: Float64Array;
  private hMax = 0;
  private nMax = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.vMin = new Float64Array(cap);
    this.sMin = new Float64Array(cap);
    this.vMax = new Float64Array(cap);
    this.sMax = new Float64Array(cap);
  }

  /** Reset to empty (keeps allocated buffers). */
  clear(): void {
    this.hMin = this.nMin = this.hMax = this.nMax = 0;
  }

  /**
   * Record a new sample and slide the window forward.
   * @param value the sample value
   * @param seq globally increasing sample id
   * @param windowStart oldest seq still inside the window
   */
  push(value: number, seq: number, windowStart: number): void {
    const cap = this.cap;

    // Canonical order (evict → pop → append) keeps each deque length ≤ cap.
    const vMin = this.vMin;
    const sMin = this.sMin;
    while (this.nMin > 0 && sMin[this.hMin] < windowStart) {
      this.hMin = this.hMin + 1 === cap ? 0 : this.hMin + 1;
      this.nMin--;
    }
    while (this.nMin > 0 && vMin[(this.hMin + this.nMin - 1) % cap] >= value) {
      this.nMin--;
    }
    let ib = (this.hMin + this.nMin) % cap;
    vMin[ib] = value;
    sMin[ib] = seq;
    this.nMin++;

    const vMax = this.vMax;
    const sMax = this.sMax;
    while (this.nMax > 0 && sMax[this.hMax] < windowStart) {
      this.hMax = this.hMax + 1 === cap ? 0 : this.hMax + 1;
      this.nMax--;
    }
    while (this.nMax > 0 && vMax[(this.hMax + this.nMax - 1) % cap] <= value) {
      this.nMax--;
    }
    ib = (this.hMax + this.nMax) % cap;
    vMax[ib] = value;
    sMax[ib] = seq;
    this.nMax++;
  }

  /** Current window minimum. */
  get min(): number {
    return this.vMin[this.hMin];
  }
  /** Current window maximum. */
  get max(): number {
    return this.vMax[this.hMax];
  }
}
