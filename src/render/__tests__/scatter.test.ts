import { describe, it, expect } from 'vitest';
import { createMockCtx } from './ctx-mock';
import { renderScatter } from '../scatter';

function makeView(xs: number[], ys: number[]) {
  const xArr = new Float64Array(xs) as unknown as Float64Array<ArrayBufferLike>;
  const yArr = new Float64Array(ys) as unknown as Float64Array<ArrayBufferLike>;
  return {
    xArr,
    yArr,
    head: 0,
    count: xs.length,
    cap: xs.length,
    xMin: xs[0] ?? 0,
    xMax: xs[xs.length - 1] ?? 0,
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
    physOf: (i: number) => i,
    bracketLogical: () => 0,
  };
}

const plot = { x: 50, y: 30, w: 400, h: 200 };
const opts = { lineColor: '#f00', pointRadius: 4, maxDots: 2000 };

describe('renderScatter', () => {
  it('série vazia não desenha nada', () => {
    const mc = createMockCtx();
    renderScatter(mc, makeView([], []), plot, opts as any);
    expect(mc.calls.beginPath).toBe(0);
    expect(mc.calls.fill).toBe(0);
  });

  it('N < maxDots: desenha todos os pontos', () => {
    const mc = createMockCtx();
    const xs = [0, 50, 100];
    const ys = [10, 50, 90];
    renderScatter(mc, makeView(xs, ys), plot, opts as any);
    expect(mc.calls.beginPath).toBe(1);
    expect(mc.calls.fill).toBe(1);
    expect(mc.calls.arc.length).toBe(3);
  });

  it('N > maxDots: stride thinning reduz pontos (step=2)', () => {
    const mc = createMockCtx();
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 5000; i++) {
      xs.push(i);
      ys.push(Math.random() * 100);
    }
    // maxDots=2000 => step = floor(5000/2000) = 2 => ~2500 pontos
    // stride thinning desenha a cada step pontos, não exatamente maxDots
    const maxDots = 2000;
    const expectedStep = Math.floor(5000 / maxDots);
    const expectedCount = Math.ceil(5000 / expectedStep);
    renderScatter(mc, makeView(xs, ys), plot, { ...opts, maxDots } as any);
    expect(mc.calls.beginPath).toBe(1);
    expect(mc.calls.fill).toBe(1);
    expect(mc.calls.arc.length).toBe(expectedCount);
  });
});
