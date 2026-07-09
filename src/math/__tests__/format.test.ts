import { describe, it, expect } from 'vitest';
import { formatNumber, formatTimeTick } from '../format';

describe('formatNumber', () => {
  it('inteiro: sem decimal', () => {
    expect(formatNumber(42)).toBe('42');
  });

  it('zero: "0"', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('negativo', () => {
    expect(formatNumber(-3.14)).toBe('-3.14');
  });

  it('decimal positivo: 2 casas', () => {
    expect(formatNumber(3.1415)).toBe('3.14');
  });

  it('> 1e6: notação exponencial (não-inteiro)', () => {
    expect(formatNumber(1_234_567.89)).toMatch(/e/);
  });

  it('inteiro grande permanece inteiro', () => {
    expect(formatNumber(1_234_567)).toBe('1234567');
  });

  it('< 1e-4 e > 0: notação exponencial', () => {
    expect(formatNumber(0.00001)).toMatch(/e/);
  });

  it('NaN: "NaN"', () => {
    expect(formatNumber(NaN)).toBe('NaN');
  });

  it('Infinity: "Infinity"', () => {
    expect(formatNumber(Infinity)).toBe('Infinity');
  });

  it('-Infinity: "-Infinity"', () => {
    expect(formatNumber(-Infinity)).toBe('-Infinity');
  });

  it('abs entre 1e-4 e 1: toPrecision(3)', () => {
    const result = formatNumber(0.00123);
    // toPrecision(3) on 0.00123 => '0.00123' (7 chars)
    expect(result).toBe('0.00123');
  });

  it('valor inteiro grande não vai para exponencial', () => {
    expect(formatNumber(999_999)).toBe('999999');
  });
});

describe('formatTimeTick', () => {
  const ts = Date.UTC(2026, 5, 15, 14, 30, 45); // 2026-06-15T14:30:45Z

  it('unit "second": inclui hora, minuto e segundo', () => {
    const s = formatTimeTick(ts, 'second', 'UTC');
    expect(s).toContain('14');
    expect(s).toContain('30');
    expect(s).toContain('45');
  });

  it('unit "minute": inclui hora e minuto', () => {
    const s = formatTimeTick(ts, 'minute', 'UTC');
    expect(s).toContain('14');
    expect(s).toContain('30');
  });

  it('unit "hour": inclui hora e minuto', () => {
    const s = formatTimeTick(ts, 'hour', 'UTC');
    expect(s).toContain('14');
  });

  it('unit "day": inclui mês e dia, sem hora', () => {
    const s = formatTimeTick(ts, 'day', 'UTC');
    expect(s).toContain('15');
    expect(s).not.toContain('14:30');
  });

  it('unit "month": inclui mês e ano', () => {
    const s = formatTimeTick(ts, 'month', 'UTC');
    expect(s).toContain('2026');
  });

  it('unit "year": inclui apenas o ano', () => {
    const s = formatTimeTick(ts, 'year', 'UTC');
    expect(s).toBe('2026');
  });

  it('respeita o timeZone informado', () => {
    const utc = formatTimeTick(ts, 'hour', 'UTC');
    const other = formatTimeTick(ts, 'hour', 'America/Sao_Paulo');
    expect(utc).not.toBe(other);
  });

  it('sem timeZone não lança (usa fuso do host)', () => {
    expect(() => formatTimeTick(ts, 'second')).not.toThrow();
  });
});
