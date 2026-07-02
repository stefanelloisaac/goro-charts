import { describe, it, expect } from 'vitest';
import { generateTicks } from '../ticks';

describe('generateTicks', () => {
  it('range normal produz ticks esperados', () => {
    const ticks = generateTicks(0, 100, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(100);
  });

  it('range zero produz ticks ao redor do valor', () => {
    const ticks = generateTicks(50, 50, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    // todos os ticks devem ser próximos de 50
    for (const t of ticks) {
      expect(Math.abs(t - 50)).toBeLessThanOrEqual(2);
    }
  });

  it('range negativo funciona', () => {
    const ticks = generateTicks(-50, 50, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    // generateTicks usa Math.ceil(min/spacing)*spacing, que pode ser > min
    // Ex: min=-50, spacing=20 => ceil(-2.5)*20 = -40
    expect(ticks[0]).toBeGreaterThanOrEqual(-60);
    expect(ticks[0]).toBeLessThanOrEqual(-40);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(40);
  });

  it('maxTicks=1 produz ao menos 1 tick', () => {
    const ticks = generateTicks(0, 100, 1);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
  });

  it('ranges pequenos (< 1) funcionam', () => {
    const ticks = generateTicks(0, 0.5, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  it('ranges grandes (> 1e6) funcionam', () => {
    const ticks = generateTicks(0, 10_000_000, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    // espaçamento deve ser "nice": 1, 2, ou 5 × 10^k
    const spacing = ticks[1] - ticks[0];
    const log10 = Math.log10(spacing);
    const frac = spacing / Math.pow(10, Math.floor(log10));
    expect([1, 2, 5, 10]).toContain(frac);
  });

  it('valores negativos e positivos juntos', () => {
    const ticks = generateTicks(-10, 10, 5);
    expect(ticks.some((t) => t === 0)).toBe(true);
  });
});
