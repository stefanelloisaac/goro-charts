// Synthetic data generators for each panel (static datasets + streaming values).
import { P, chart, stream } from './state.js';

// Right-axis series live on a larger scale so the dual-Y is visibly different.
export const scaleOf = (s) => (s.axis === 'right' ? { off: 500, amp: 280 } : { off: 50, amp: 38 });
export const noise = (a) => (Math.random() - 0.5) * 2 * a;

// Deterministic value at absolute time t (random walk is stateful, handled separately).
export function detAt(pi, si, t) {
  const s = P[pi].series[si];
  const { off, amp } = scaleOf(s);
  const sh = P[pi].shape;
  const streaming = P[pi].mode === 'stream';
  const freq = (streaming ? 0.05 : 0.015) + si * (streaming ? 0.02 : 0.006);
  const ph = si * 1.3;
  if (sh === 'steps') {
    const seg = Math.floor(t / (streaming ? 40 : P[pi].win / 8));
    return off + (((seg + si) % 4) / 3) * amp * 1.4 - amp * 0.6;
  }
  const nz = sh === 'noisy';
  return off + Math.sin(t * freq + ph) * amp + (nz ? noise(amp * 0.35) : 0);
}

export function genStatic(pi) {
  const N = P[pi].win;
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = i;
  return P[pi].series.map((s, si) => {
    const y = new Float64Array(N);
    const { off, amp } = scaleOf(s);
    if (P[pi].shape === 'walk') {
      let v = off;
      for (let i = 0; i < N; i++) {
        v += noise(amp * 0.08);
        y[i] = v;
      }
    } else {
      for (let i = 0; i < N; i++) y[i] = detAt(pi, si, i);
    }
    return { x, y };
  });
}

export function feedStatic(pi) {
  const data = genStatic(pi);
  chart[pi].batch(() => data.forEach((d, i) => chart[pi].setData(i, d.x, d.y)));
}

export function resetStream(pi) {
  stream[pi].t = 0;
  P[pi].series.forEach((s, i) => {
    stream[pi].walk[i] = scaleOf(s).off;
  });
}

// Reset counter AND empty the ring so the next append restarts monotonic X from 0.
export function clearStream(pi) {
  resetStream(pi);
  if (chart[pi]) chart[pi].clear();
}
