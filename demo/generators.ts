/**
 * @file Simple signal generators for the demo.
 *
 * Each function takes a mutable state object and returns the next value.
 * No interfaces or closures — just plain functions operating on plain objects.
 */

export interface RandomWalkState {
  v: number;
}

/** Bounded random walk in [0, 100] – feels like CPU load. */
export function nextRandomWalk(s: RandomWalkState): number {
  s.v += (Math.random() - 0.5) * 4;
  if (s.v < 0) s.v = 0;
  if (s.v > 100) s.v = 100;
  return s.v;
}

export interface NoisySineState {
  i: number;
  base: number;
  amp: number;
  period: number;
  noise: number;
}

/** Sine over a busy baseline with noise – feels like requests/sec. */
export function nextNoisySine(s: NoisySineState): number {
  s.i++;
  return s.base + Math.sin(s.i * ((2 * Math.PI) / s.period)) * s.amp + (Math.random() - 0.5) * s.noise;
}

export interface SpikyState {
  v: number;
}

/** Low baseline with decaying bursts – feels like network packets. */
export function nextSpiky(s: SpikyState): number {
  s.v += (Math.random() - 0.5) * 2;
  if (s.v < 2) s.v = 2;
  if (Math.random() < 0.01) s.v += Math.random() * 40;
  s.v *= 0.96;
  return s.v;
}
