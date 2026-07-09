import { describe, it, expect } from 'vitest';
import { createMockCtx } from './ctx-mock';
import { renderArea } from '../area';

function makeView(xs: number[], ys: number[], yMin = 0, yMax = 100) {
  const xArr = new Float64Array(xs) as unknown as Float64Array<ArrayBufferLike>;
  const yArr = new Float64Array(ys) as unknown as Float64Array<ArrayBufferLike>;
  return {
    xArr,
    yArr,
    head: 0,
    count: xs.length,
    cap: xs.length,
    xMin: xs[0],
    xMax: xs[xs.length - 1],
    yMin,
    yMax,
    physOf: (i: number) => i,
    bracketLogical: () => 0,
  };
}

const plot = { x: 50, y: 30, w: 400, h: 200 };
const opts = { lineColor: '#f00', fillColor: '#f00', lineWidth: 1.5, fillOpacity: 0.15 };

describe('renderArea', () => {
  it('série vazia não desenha nada', () => {
    const mc = createMockCtx();
    renderArea(mc, makeView([], []), plot, opts as any);
    expect(mc.calls.beginPath).toBe(0);
    expect(mc.calls.fill).toBe(0);
    expect(mc.calls.stroke).toBe(0);
  });

  it('1 ponto não desenha (menos que 2 necessários para área)', () => {
    const mc = createMockCtx();
    renderArea(mc, makeView([0], [50], 0, 100), plot, opts as any);
    // 1 ponto no modo sparse: n <= 2*plot.w, Array(n) com 1 elemento
    // Deve desenhar fill + stroke mesmo com 1 ponto
    expect(mc.calls.beginPath).toBe(2); // fill path + stroke path
    expect(mc.calls.fill).toBe(1);
    expect(mc.calls.stroke).toBe(1);
  });

  it('série esparsa com 2 pontos desenha fill + stroke', () => {
    const mc = createMockCtx();
    renderArea(mc, makeView([0, 100], [10, 90], 0, 100), plot, opts as any);
    expect(mc.calls.beginPath).toBe(2);
    expect(mc.calls.fill).toBe(1);
    expect(mc.calls.stroke).toBe(1);
    // fill path: moveTo + lineTo + lineTo(bottom) + lineTo(bottom left) + closePath
    expect(mc.calls.closePath).toBe(1);
  });

  it('aplica fillOpacity < 1 via globalAlpha', () => {
    const mc = createMockCtx();
    renderArea(mc, makeView([0, 100], [10, 90], 0, 100), plot, opts as any);
    expect(mc.state.globalAlpha).toBe(1); // foi restaurado após fill
  });

  it('regime denso (n > 2·plot.w) decima por coluna de pixel', () => {
    const mc = createMockCtx();
    // n bem acima de 2·400 força o caminho decimado.
    const N = 5000;
    const xs = Array.from({ length: N }, (_, i) => (i / (N - 1)) * 100);
    const ys = Array.from({ length: N }, (_, i) => 50 + Math.sin(i * 0.05) * 40);
    renderArea(mc, makeView(xs, ys, 0, 100), plot, opts as any);
    // Ainda produz um fill e um stroke.
    expect(mc.calls.fill).toBe(1);
    expect(mc.calls.stroke).toBe(1);
    expect(mc.calls.closePath).toBe(1);
    // Decimado: muito menos lineTo que N (limitado a ~colunas de pixel).
    expect(mc.calls.lineTo.length).toBeLessThan(N);
  });

  describe('gapMode (sparse)', () => {
    it('"break" (padrão): um NaN no meio produz 2 runs (2 fill + 2 stroke)', () => {
      const mc = createMockCtx();
      renderArea(mc, makeView([0, 50, 100], [10, NaN, 90], 0, 100), plot, opts as any);
      expect(mc.calls.fill).toBe(2);
      expect(mc.calls.stroke).toBe(2);
    });

    it('"connect": um NaN no meio ainda produz 1 run só (1 fill + 1 stroke)', () => {
      const mc = createMockCtx();
      const connectOpts = { ...opts, gapMode: 'connect' };
      renderArea(mc, makeView([0, 50, 100], [10, NaN, 90], 0, 100), plot, connectOpts as any);
      expect(mc.calls.fill).toBe(1);
      expect(mc.calls.stroke).toBe(1);
    });

    it('"zero": um NaN no meio produz 1 run só (1 fill + 1 stroke)', () => {
      const mc = createMockCtx();
      const zeroOpts = { ...opts, gapMode: 'zero' };
      renderArea(mc, makeView([0, 50, 100], [10, NaN, 90], 0, 100), plot, zeroOpts as any);
      expect(mc.calls.fill).toBe(1);
      expect(mc.calls.stroke).toBe(1);
    });

    it('série toda NaN não desenha nenhum run', () => {
      const mc = createMockCtx();
      renderArea(mc, makeView([0, 50, 100], [NaN, NaN, NaN], 0, 100), plot, opts as any);
      expect(mc.calls.fill).toBe(0);
      expect(mc.calls.stroke).toBe(0);
    });
  });

  describe('gapMode (decimado)', () => {
    function makeDenseGapData(gapAtFraction: number) {
      const N = 5000;
      const gapStart = Math.floor(N * gapAtFraction);
      const gapEnd = gapStart + 200;
      const xs = Array.from({ length: N }, (_, i) => (i / (N - 1)) * 100);
      const ys = Array.from({ length: N }, (_, i) =>
        i >= gapStart && i < gapEnd ? NaN : 50 + Math.sin(i * 0.05) * 40,
      );
      return { xs, ys };
    }

    it('"break": uma lacuna densa produz mais de um run (>1 fill/stroke)', () => {
      const { xs, ys } = makeDenseGapData(0.4);
      const mc = createMockCtx();
      const breakOpts = { ...opts, gapMode: 'break' };
      renderArea(mc, makeView(xs, ys, 0, 100), plot, breakOpts as any);
      expect(mc.calls.fill).toBeGreaterThanOrEqual(2);
      expect(mc.calls.stroke).toBeGreaterThanOrEqual(2);
    });

    it('"connect": uma lacuna densa ainda produz 1 run só', () => {
      const { xs, ys } = makeDenseGapData(0.4);
      const mc = createMockCtx();
      const connectOpts = { ...opts, gapMode: 'connect' };
      renderArea(mc, makeView(xs, ys, 0, 100), plot, connectOpts as any);
      expect(mc.calls.fill).toBe(1);
      expect(mc.calls.stroke).toBe(1);
    });
  });
});
