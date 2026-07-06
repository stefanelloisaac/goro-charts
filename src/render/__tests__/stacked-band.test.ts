import { describe, it, expect } from 'vitest';
import { createMockCtx } from './ctx-mock';
import { renderStackedBands } from '../stacked-band';

function makeStore(xs: number[], ys: number[]) {
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
const domain = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
const styles = [
  { lineColor: '#4ea8ff', lineWidth: 1.5, fillColor: '#4ea8ff', fillOpacity: 0.12 },
  { lineColor: '#52d4a0', lineWidth: 1.5, fillColor: '#52d4a0', fillOpacity: 0.12 },
];

describe('renderStackedBands', () => {
  it('série vazia não desenha', () => {
    const mc = createMockCtx();
    const stores = [makeStore([], [])];
    renderStackedBands(mc, stores, [styles[0]], plot, domain);
    expect(mc.calls.beginPath).toBe(0);
  });

  it('duas camadas produzem fill + stroke para cada', () => {
    const mc = createMockCtx();
    const stores = [makeStore([0, 50, 100], [10, 20, 30]), makeStore([0, 50, 100], [5, 10, 15])];
    renderStackedBands(mc, stores, styles, plot, domain);
    // Cada camada: fill (beginPath + fill) + stroke (beginPath + stroke)
    expect(mc.calls.beginPath).toBe(4);
    expect(mc.calls.fill).toBe(2);
    expect(mc.calls.stroke).toBe(2);
  });

  it('usou closePath para fechar as áreas', () => {
    const mc = createMockCtx();
    const stores = [makeStore([0, 50, 100], [10, 20, 30]), makeStore([0, 50, 100], [5, 10, 15])];
    renderStackedBands(mc, stores, styles, plot, domain);
    expect(mc.calls.closePath).toBe(2);
  });

  it('regime denso: decima para ~colunas de pixel em vez de N pontos', () => {
    const mc = createMockCtx();
    // n muito maior que 2·plot.w (400) força o caminho decimado.
    const N = 5000;
    const xs = Array.from({ length: N }, (_, i) => (i / (N - 1)) * 100);
    const ys = Array.from({ length: N }, (_, i) => 20 + Math.sin(i * 0.05) * 10);
    const stores = [makeStore(xs, ys), makeStore(xs, ys)];
    renderStackedBands(mc, stores, styles, plot, domain);
    // Sem decimação seriam ~N lineTo por camada. Com decimação, o total fica
    // limitado a ~O(plot.w) por camada — muito abaixo de N.
    expect(mc.calls.lineTo.length).toBeLessThan(N);
    expect(mc.calls.fill).toBe(2);
    expect(mc.calls.stroke).toBe(2);
  });

  it('faz clamp: cumulativo acima do domínio não vaza da borda do plot', () => {
    const mc = createMockCtx();
    // Domínio yMax=100, mas o topo acumulado (60+60=120) excede — deve ser
    // preso ao topo do plot (plot.y), nunca acima dele.
    const stores = [makeStore([0, 50, 100], [60, 60, 60]), makeStore([0, 50, 100], [60, 60, 60])];
    renderStackedBands(mc, stores, styles, plot, domain);
    const ys = [...mc.calls.moveTo, ...mc.calls.lineTo].map(([, y]) => y);
    const top = plot.y;
    const bottom = plot.y + plot.h;
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(bottom);
    }
  });
});
