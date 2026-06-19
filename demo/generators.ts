/**
 * @file Stateful signal generators for the streaming demo.
 */

export interface Generator {
  next(): number
}

/** Bounded random walk in [0, 100] — feels like CPU load. */
export function randomWalkGen(start = 50): Generator {
  let v = start
  return {
    next() {
      v += (Math.random() - 0.5) * 4
      if (v < 0) v = 0
      if (v > 100) v = 100
      return v
    },
  }
}

/** Slow sine with light noise — feels like temperature. */
export function slowSineGen(base = 50, amp = 8, period = 600): Generator {
  let i = 0
  const k = (2 * Math.PI) / period
  return {
    next() {
      const v = base + Math.sin(i * k) * amp + (Math.random() - 0.5) * 1.5
      i++
      return v
    },
  }
}

/** Sine over a busy baseline with noise — feels like requests/sec. */
export function noisySineGen(base = 8000, amp = 2500, period = 400): Generator {
  let i = 0
  const k = (2 * Math.PI) / period
  return {
    next() {
      const v = base + Math.sin(i * k) * amp + (Math.random() - 0.5) * 1200
      i++
      return v
    },
  }
}

/** Low baseline with decaying bursts — feels like network packets. */
export function spikyGen(): Generator {
  let v = 10
  return {
    next() {
      v += (Math.random() - 0.5) * 2
      if (v < 2) v = 2
      if (Math.random() < 0.01) v += Math.random() * 40
      v *= 0.96
      return v
    },
  }
}
