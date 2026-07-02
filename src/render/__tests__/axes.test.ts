import { describe, it, expect } from 'vitest';
import { createMockCtx } from './ctx-mock';
import { renderGrid, renderAxes } from '../axes';

const plot = { x: 50, y: 30, w: 400, h: 200 };
const opts = {
  gridColor: 'rgba(255,255,255,0.08)',
  axisColor: 'rgba(255,255,255,0.25)',
  textColor: 'rgba(255,255,255,0.5)',
  fontSize: 11,
  fontFamily: 'system-ui, sans-serif',
  xTicks: 8,
  yTicks: 6,
};

describe('renderGrid', () => {
  it('desenha linhas tracejadas + frame', () => {
    const mc = createMockCtx();
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    renderGrid(mc, d, plot, opts as any);
    // beginPath: 1 para hLines, 1 para vLines, strokeRect não precisa de beginPath
    expect(mc.calls.beginPath).toBe(2);
    // strokeRect deve ter sido chamado
    expect(mc.calls.strokeRect.length).toBe(1);
    expect(mc.calls.strokeRect[0]).toEqual([50, 30, 400, 200]);
  });

  it('domínio degenerado não lança', () => {
    const mc = createMockCtx();
    const d = { xMin: 50, xMax: 50, yMin: 50, yMax: 50 };
    expect(() => renderGrid(mc, d, plot, opts as any)).not.toThrow();
  });
});

describe('renderAxes', () => {
  it('renderiza labels Y no lado esquerdo e X abaixo', () => {
    const mc = createMockCtx();
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    renderAxes(mc, d, plot, opts as any, 'left');
    // Deve ter chamado fillText para cada tick Y + X
    expect(mc.calls.fillText.length).toBeGreaterThanOrEqual(4);
  });

  it('renderiza labels Y no lado direito', () => {
    const mc = createMockCtx();
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    renderAxes(mc, d, plot, opts as any, 'right');
    // Apenas Y ticks (sem X ticks no lado direito)
    // textAlign deve ser 'left' para o lado direito
    expect(mc.state.textAlign).toBe('left');
  });
});
