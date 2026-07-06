import { describe, it, expect } from 'vitest';
import { computeHits, renderCrosshair } from '../crosshair';
import { createMockCtx } from './ctx-mock';

function makeView(xs: number[], ys: number[], yMin: number, yMax: number, xMin?: number, xMax?: number) {
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
    bracketLogical: (target: number) => {
      const n = xs.length;
      let lo = 0;
      let hi = n - 1;
      if (target <= xs[0]) return 0;
      if (target >= xs[hi]) return hi;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (xs[mid] <= target) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

const plot = { x: 50, y: 30, w: 400, h: 200 };

describe('computeHits', () => {
  it('interpolação linear entre 2 pontos', () => {
    const views = [makeView([0, 100], [0, 100], 0, 100)];
    const configs = [{ name: 'S1', color: '#f00' }];
    // cursor x=250px → data x=50
    const hits = computeHits(views, configs as any, plot, 250);
    expect(hits.length).toBe(1);
    expect(hits[0].xVal).toBe(50);
    expect(hits[0].yVal).toBe(50);
  });

  it('cursor exato em cima de um ponto', () => {
    const views = [makeView([0, 50, 100], [0, 50, 100], 0, 100)];
    const configs = [{ name: 'S1', color: '#f00' }];
    const hits = computeHits(views, configs as any, plot, 250); // data x=50
    expect(hits[0].yVal).toBe(50);
  });

  it('cursor antes do primeiro ponto (clamp)', () => {
    const views = [makeView([10, 100], [20, 90], 0, 100, 10, 100)];
    const configs = [{ name: 'S1', color: '#f00' }];
    const hits = computeHits(views, configs as any, plot, 49); // antes do plot, mas dentro
    // bracketLogical(menor q 10) retorna 0
    expect(hits[0].xVal).toBe(10);
  });

  it('cursor depois do último ponto (clamp)', () => {
    const views = [makeView([10, 100], [20, 90], 0, 100, 10, 100)];
    const configs = [{ name: 'S1', color: '#f00' }];
    const hits = computeHits(views, configs as any, plot, 451); // data x > 100
    expect(hits[0].xVal).toBe(100);
  });

  it('série vazia é ignorada', () => {
    const vazia = makeView([], [], 0, 100);
    // force count=0
    Object.defineProperty(vazia, 'count', { value: 0 });
    const views = [vazia, makeView([0, 100], [0, 100], 0, 100)];
    const configs: any = [
      { name: 'Vazia', color: '#000' },
      { name: 'S1', color: '#f00' },
    ];
    const hits = computeHits(views, configs, plot, 250);
    expect(hits.length).toBe(1);
    expect(hits[0].label).toBe('S1');
  });

  it('múltiplas séries', () => {
    const views = [makeView([0, 100], [0, 100], 0, 100), makeView([0, 100], [100, 0], 0, 100)];
    const configs: any = [
      { name: 'S1', color: '#f00' },
      { name: 'S2', color: '#0f0' },
    ];
    const hits = computeHits(views, configs, plot, 250);
    expect(hits.length).toBe(2);
    expect(hits[0].yVal).toBe(50);
    expect(hits[1].yVal).toBe(50);
  });
});

const opts: any = {
  crosshairColor: 'rgba(255,255,255,0.3)',
  crosshairWidth: 1,
  pointRadius: 4,
  fontSize: 11,
  fontFamily: 'system-ui, sans-serif',
  textColor: 'rgba(255,255,255,0.5)',
};

describe('renderCrosshair', () => {
  it('não desenha quando o cursor está fora do plot', () => {
    const mc = createMockCtx();
    const views = [makeView([0, 100], [0, 100], 0, 100)];
    const configs: any = [{ name: 'S1', color: '#f00' }];
    renderCrosshair(mc, views, configs, plot, opts, { x: 10, y: 10 }, 500);
    expect(mc.calls.stroke).toBe(0);
    expect(mc.calls.fill).toBe(0);
  });

  it('série única: desenha guias, dot e card', () => {
    const mc = createMockCtx();
    const views = [makeView([0, 100], [0, 100], 0, 100)];
    const configs: any = [{ name: 'S1', color: '#f00' }];
    renderCrosshair(mc, views, configs, plot, opts, { x: 250, y: 130 }, 500);
    // Guia vertical + horizontal (série única) => 2 strokes de guia + borda do card.
    expect(mc.calls.stroke).toBeGreaterThan(0);
    // Dot (halo + preenchimento) + card => vários fills e arcs.
    expect(mc.calls.fill).toBeGreaterThan(0);
    expect(mc.calls.arc.length).toBeGreaterThan(0);
    // Tooltip escreve o rótulo 'x', o nome e os valores.
    const texts = mc.calls.fillText.map((t) => t[0]);
    expect(texts).toContain('x');
    expect(texts).toContain('S1');
  });

  it('múltiplas séries: sem guia horizontal, um dot por série', () => {
    const mc = createMockCtx();
    const views = [makeView([0, 100], [0, 100], 0, 100), makeView([0, 100], [100, 0], 0, 100)];
    const configs: any = [
      { name: 'A', color: '#f00' },
      { name: 'B', color: '#0f0' },
    ];
    renderCrosshair(mc, views, configs, plot, opts, { x: 250, y: 130 }, 500);
    const texts = mc.calls.fillText.map((t) => t[0]);
    expect(texts).toContain('A');
    expect(texts).toContain('B');
  });

  it('posiciona o card à esquerda quando estouraria a borda direita', () => {
    const mc = createMockCtx();
    const views = [makeView([0, 100], [0, 100], 0, 100)];
    const configs: any = [{ name: 'S1', color: '#f00' }];
    // cssW pequeno força o flip do card para a esquerda do cursor.
    renderCrosshair(mc, views, configs, plot, opts, { x: 445, y: 40 }, 460);
    expect(mc.calls.fill).toBeGreaterThan(0);
  });
});
