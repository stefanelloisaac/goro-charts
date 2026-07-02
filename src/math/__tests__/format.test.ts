import { describe, it, expect } from 'vitest';
import { formatNumber } from '../format';

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
