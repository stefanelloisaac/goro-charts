import { describe, it, expect } from 'vitest';
import { createMockCtx } from './ctx-mock';
import { renderLegend } from '../legend';

const plot = { x: 50, y: 30, w: 400, h: 200 };
const opts = { fontSize: 11, fontFamily: 'system-ui, sans-serif', textColor: 'rgba(255,255,255,0.5)' };

describe('renderLegend', () => {
  it('1 série: não desenha', () => {
    const mc = createMockCtx();
    renderLegend(mc, [{ name: 'S1', color: '#f00' }], plot, opts as any);
    expect(mc.calls.beginPath).toBe(0);
  });

  it('2 séries com espaço suficiente: horizontal', () => {
    const mc = createMockCtx();
    renderLegend(
      mc,
      [
        { name: 'CPU', color: '#4ea8ff' },
        { name: 'Mem', color: '#f00' },
      ],
      plot,
      opts as any,
    );
    expect(mc.calls.beginPath).toBeGreaterThanOrEqual(2); // bg + border
    // Deve ter chamado fillText (ao menos 2 labels)
    expect(mc.calls.fillText.length).toBeGreaterThanOrEqual(2);
  });

  it('muitas séries sem espaço: vertical', () => {
    const mc = createMockCtx();
    const configs = [
      { name: 'Series A Very Long Name', color: '#a00' },
      { name: 'Series B Also Long', color: '#0a0' },
      { name: 'Series C', color: '#00a' },
    ];
    renderLegend(mc, configs, plot, opts as any);
    expect(mc.calls.fillText.length).toBeGreaterThanOrEqual(3);
  });
});
