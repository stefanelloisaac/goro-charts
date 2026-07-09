import { describe, it, expect } from 'vitest';
import { generateTicks, generateTimeTicks } from '../ticks';

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

describe('generateTimeTicks', () => {
  it('domínio degenerado retorna 1 tick', () => {
    const { values, unit } = generateTimeTicks(1000, 1000, 6);
    expect(values).toEqual([1000]);
    expect(unit).toBe('second');
  });

  it('domínio invertido (max < min) retorna 1 tick sem lançar', () => {
    expect(() => generateTimeTicks(1000, 500, 6)).not.toThrow();
  });

  it('granularidade de segundo: range de poucos segundos', () => {
    const min = Date.UTC(2026, 0, 1, 0, 0, 0);
    const max = Date.UTC(2026, 0, 1, 0, 0, 10);
    const { values, unit } = generateTimeTicks(min, max, 6);
    expect(unit).toBe('second');
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values[0]).toBeGreaterThanOrEqual(min - 1000);
    expect(values[values.length - 1]).toBeLessThanOrEqual(max + 1000);
  });

  it('granularidade de minuto: range de ~10 minutos', () => {
    const min = Date.UTC(2026, 0, 1, 0, 0, 0);
    const max = Date.UTC(2026, 0, 1, 0, 10, 0);
    const { values, unit } = generateTimeTicks(min, max, 6);
    expect(unit).toBe('minute');
    expect(values.length).toBeGreaterThanOrEqual(2);
  });

  it('granularidade de hora: range de ~12 horas', () => {
    const min = Date.UTC(2026, 0, 1, 0, 0, 0);
    const max = Date.UTC(2026, 0, 1, 12, 0, 0);
    const { values, unit } = generateTimeTicks(min, max, 6);
    expect(unit).toBe('hour');
    expect(values.length).toBeGreaterThanOrEqual(2);
  });

  it('granularidade de dia: range de ~10 dias', () => {
    const min = Date.UTC(2026, 0, 1);
    const max = Date.UTC(2026, 0, 11);
    const { values, unit } = generateTimeTicks(min, max, 6);
    expect(unit === 'day' || unit === 'week').toBe(true);
    expect(values.length).toBeGreaterThanOrEqual(2);
  });

  it('granularidade de mês: range de ~8 meses cai em limites de mês (dia 1 UTC)', () => {
    const min = Date.UTC(2026, 0, 1);
    const max = Date.UTC(2026, 7, 1);
    const { values, unit } = generateTimeTicks(min, max, 6);
    expect(unit === 'month' || unit === 'quarter').toBe(true);
    for (const v of values) {
      const d = new Date(v);
      expect(d.getUTCDate()).toBe(1);
    }
  });

  it('granularidade de ano: range de vários anos cai em 1º de janeiro', () => {
    const min = Date.UTC(2000, 0, 1);
    const max = Date.UTC(2026, 0, 1);
    const { values, unit } = generateTimeTicks(min, max, 6);
    expect(unit).toBe('year');
    for (const v of values) {
      const d = new Date(v);
      expect(d.getUTCMonth()).toBe(0);
      expect(d.getUTCDate()).toBe(1);
    }
  });

  it('range extremamente grande (múltiplos séculos) não lança e usa unidade ano', () => {
    const min = Date.UTC(1800, 0, 1);
    const max = Date.UTC(2026, 0, 1);
    expect(() => generateTimeTicks(min, max, 6)).not.toThrow();
    const { unit, values } = generateTimeTicks(min, max, 6);
    expect(unit).toBe('year');
    expect(values.length).toBeGreaterThan(0);
  });

  it('valores em ordem ascendente', () => {
    const min = Date.UTC(2026, 0, 1);
    const max = Date.UTC(2026, 0, 2);
    const { values } = generateTimeTicks(min, max, 8);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it('todos os ticks caem dentro (ou perto) do domínio', () => {
    const min = Date.UTC(2026, 0, 1);
    const max = Date.UTC(2026, 0, 2);
    const { values } = generateTimeTicks(min, max, 8);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThanOrEqual(max);
    }
  });
});
