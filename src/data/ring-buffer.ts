/**
 * @file Fixed-capacity ring buffer of parallel (x, y) Float64Arrays.
 *
 * Append is O(1) with no memmove: once the window is full the oldest sample is
 * overwritten in place and `head` advances. y-extent is maintained
 * incrementally by a {@link MonotonicExtent}, so min/max are O(1) too.
 *
 * Logical order (oldest→newest) is `head, head+1, … head+count-1` (mod cap).
 * x is assumed monotonically increasing in push order, so it stays sorted in
 * logical order — which the crosshair's binary search relies on.
 */

import { MonotonicExtent } from './monotonic-extent.ts'

/** Sliding-window columnar store for streaming (ring) mode. */
export class RingBuffer {
  cap: number
  x: Float64Array
  y: Float64Array
  head = 0
  count = 0
  private seq = 0
  private ext: MonotonicExtent

  constructor(cap: number) {
    this.cap = cap
    this.x = new Float64Array(cap)
    this.y = new Float64Array(cap)
    this.ext = new MonotonicExtent(cap)
  }

  /** Current window y minimum (O(1)). */
  get yMin(): number {
    return this.ext.min
  }
  /** Current window y maximum (O(1)). */
  get yMax(): number {
    return this.ext.max
  }
  /** x of the oldest sample. */
  get xFirst(): number {
    return this.x[this.head]
  }
  /** x of the newest sample. */
  get xLast(): number {
    const p = this.head + this.count - 1
    return this.x[p >= this.cap ? p - this.cap : p]
  }
  /** y of the newest sample. */
  get lastY(): number {
    const p = this.head + this.count - 1
    return this.y[p >= this.cap ? p - this.cap : p]
  }

  /** Map a logical index [0, count) to its physical slot. */
  physOf(logical: number): number {
    const p = this.head + logical
    return p >= this.cap ? p - this.cap : p
  }

  /** Append one sample. x must be ≥ the previous x (monotonic). */
  push(xv: number, yv: number): void {
    let phys: number
    if (this.count < this.cap) {
      phys = this.head + this.count
      if (phys >= this.cap) phys -= this.cap
      this.count++
    } else {
      phys = this.head
      this.head = this.head + 1 === this.cap ? 0 : this.head + 1
    }
    this.x[phys] = xv
    this.y[phys] = yv

    const s = this.seq++
    this.ext.push(yv, s, s - this.count + 1)
  }

  /** Reset to empty (keeps allocated buffers). */
  clear(): void {
    this.head = 0
    this.count = 0
    this.seq = 0
    this.ext.clear()
  }

  /**
   * Resize the window, preserving the most recent samples. Rare and O(keep):
   * the retained tail is copied out, fresh buffers allocated, then re-pushed so
   * the extent deque rebuilds correctly.
   */
  resize(newCap: number): void {
    if (newCap === this.cap || newCap < 1) return

    const keep = Math.min(this.count, newCap)
    const startLogical = this.count - keep
    const tx = new Float64Array(keep)
    const ty = new Float64Array(keep)
    for (let i = 0; i < keep; i++) {
      const p = this.physOf(startLogical + i)
      tx[i] = this.x[p]
      ty[i] = this.y[p]
    }

    this.cap = newCap
    this.x = new Float64Array(newCap)
    this.y = new Float64Array(newCap)
    this.ext = new MonotonicExtent(newCap)
    this.head = 0
    this.count = 0
    this.seq = 0
    for (let i = 0; i < keep; i++) this.push(tx[i], ty[i])
  }
}
