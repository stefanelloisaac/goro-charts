import { describe, it, expect } from 'vitest';
import { createMockCtx } from './ctx-mock';
import { renderLine } from '../line';

function makeView(xs: number[], ys: number[], yMin = 0, yMax = 100, xMin?: number, xMax?: number) {
  const xArr = new Float64Array(xs) as unknown as Float64Array<ArrayBufferLike>;
  const yArr = new Float64Array(ys) as unknown as Float64Array<ArrayBufferLike>;
  return {
    xArr,
    yArr,
    head: 0,
    count: xs.length,
    cap: xs.length,
    xMin: xMin ?? xs[0],
    xMax: xMax ?? xs[xs.length - 1],
    yMin,
    yMax,
    physOf: (i: number) => i,
    bracketLogical: (t: number) => {
      let lo = 0,
        hi = xs.length - 1;
      if (t <= xs[0]) return 0;
      if (t >= xs[hi]) return hi;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (xs[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

const plot = { x: 50, y: 30, w: 400, h: 200 };
const opts = { lineColor: '#f00', lineWidth: 1.5 };

describe('renderLine', () => {
  it('série vazia não desenha nada', () => {
    const mc = createMockCtx();
    renderLine(mc, makeView([], []), plot, opts as any);
    expect(mc.calls.beginPath).toBe(0);
    expect(mc.calls.stroke).toBe(0);
  });

  it('1 ponto: moveTo + stroke', () => {
    const mc = createMockCtx();
    renderLine(mc, makeView([0], [50]), plot, opts as any);
    expect(mc.calls.beginPath).toBe(1);
    expect(mc.calls.stroke).toBe(1);
    expect(mc.calls.moveTo.length).toBe(1);
    // xOff + 0 * xScale, yOff - 50 * yScale
    // xOff = 50 - 0 * (400/0) = 50 — na verdade xRange=0, xScale=0
    // Melhor: usar range > 0
  });

  it('série esparsa (2 pontos) desenha linha', () => {
    const mc = createMockCtx();
    renderLine(mc, makeView([0, 100], [10, 90], 0, 100), plot, opts as any);
    expect(mc.calls.beginPath).toBe(1);
    expect(mc.calls.moveTo.length).toBe(1);
    expect(mc.calls.stroke).toBe(1);
  });

  it('série densa (decimação) ativa envelope', () => {
    // plot.w * 2 = 800, então 1000 pontos > 800 ativa decimação
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 1000; i++) {
      xs.push(i);
      ys.push(Math.sin(i * 0.1) * 40 + 50);
    }
    const mc = createMockCtx();
    renderLine(mc, makeView(xs, ys, 0, 100, 0, 999), plot, opts as any);
    expect(mc.calls.beginPath).toBe(1);
    expect(mc.calls.stroke).toBe(1);
    // No modo decimado, moveTo é chamado 1 vez (started = false)
    expect(mc.calls.moveTo.length).toBe(1);
    // lineTo deve ser chamado muitas vezes (4 por coluna)
    expect(mc.calls.lineTo.length).toBeGreaterThan(100);
  });

  it('usa strokeStyle e lineWidth do opts', () => {
    const mc = createMockCtx();
    renderLine(mc, makeView([0, 100], [10, 90], 0, 100), plot, opts as any);
    expect(mc.state.strokeStyle).toBe('#f00');
    expect(mc.state.lineWidth).toBe(1.5);
  });

  describe('gapMode (sparse)', () => {
    it('sem gapMode explícito, usa "break" por padrão (2 moveTo em torno do NaN)', () => {
      const mc = createMockCtx();
      renderLine(mc, makeView([0, 50, 100], [10, NaN, 90], 0, 100), plot, opts as any);
      // 2 pontos válidos separados por um gap → cada um inicia seu próprio sub-path.
      expect(mc.calls.moveTo.length).toBe(2);
      expect(mc.calls.lineTo.length).toBe(0);
    });

    it('"break": lifta o pen no NaN, retomando com moveTo', () => {
      const mc = createMockCtx();
      const breakOpts = { ...opts, gapMode: 'break' };
      renderLine(mc, makeView([0, 50, 100], [10, NaN, 90], 0, 100), plot, breakOpts as any);
      expect(mc.calls.moveTo.length).toBe(2);
      expect(mc.calls.lineTo.length).toBe(0);
    });

    it('"connect": pula o NaN e liga os vizinhos válidos direto', () => {
      const mc = createMockCtx();
      const connectOpts = { ...opts, gapMode: 'connect' };
      renderLine(mc, makeView([0, 50, 100], [10, NaN, 90], 0, 100), plot, connectOpts as any);
      expect(mc.calls.moveTo.length).toBe(1);
      expect(mc.calls.lineTo.length).toBe(1);
    });

    it('"zero": desenha o ponto do gap como y=0, mantendo um único sub-path', () => {
      const mc = createMockCtx();
      const zeroOpts = { ...opts, gapMode: 'zero' };
      renderLine(mc, makeView([0, 50, 100], [10, NaN, 90], 0, 100), plot, zeroOpts as any);
      expect(mc.calls.moveTo.length).toBe(1);
      expect(mc.calls.lineTo.length).toBe(2);
    });

    it('série toda NaN não desenha nada', () => {
      const mc = createMockCtx();
      renderLine(mc, makeView([0, 50, 100], [NaN, NaN, NaN], 0, 100), plot, opts as any);
      expect(mc.calls.moveTo.length).toBe(0);
      expect(mc.calls.lineTo.length).toBe(0);
      // beginPath/stroke ainda são chamados (early return só ocorre em n===0).
      expect(mc.calls.beginPath).toBe(1);
    });
  });

  describe('gapMode (decimado)', () => {
    function makeDenseGapData(gapAtFraction: number) {
      const xs: number[] = [];
      const ys: number[] = [];
      const n = 1000;
      const gapStart = Math.floor(n * gapAtFraction);
      const gapEnd = gapStart + 50;
      for (let i = 0; i < n; i++) {
        xs.push(i);
        ys.push(i >= gapStart && i < gapEnd ? NaN : Math.sin(i * 0.1) * 40 + 50);
      }
      return { xs, ys };
    }

    it('"break": produz mais de um moveTo quando há uma lacuna densa', () => {
      const { xs, ys } = makeDenseGapData(0.4);
      const mc = createMockCtx();
      const breakOpts = { ...opts, gapMode: 'break' };
      renderLine(mc, makeView(xs, ys, 0, 100, 0, 999), plot, breakOpts as any);
      expect(mc.calls.moveTo.length).toBeGreaterThanOrEqual(2);
    });

    it('"connect": produz exatamente 1 moveTo mesmo com lacuna densa', () => {
      const { xs, ys } = makeDenseGapData(0.4);
      const mc = createMockCtx();
      const connectOpts = { ...opts, gapMode: 'connect' };
      renderLine(mc, makeView(xs, ys, 0, 100, 0, 999), plot, connectOpts as any);
      expect(mc.calls.moveTo.length).toBe(1);
    });

    it('"zero": produz exatamente 1 moveTo (todo o range vira um único envelope)', () => {
      const { xs, ys } = makeDenseGapData(0.4);
      const mc = createMockCtx();
      const zeroOpts = { ...opts, gapMode: 'zero' };
      renderLine(mc, makeView(xs, ys, 0, 100, 0, 999), plot, zeroOpts as any);
      expect(mc.calls.moveTo.length).toBe(1);
    });
  });
});
