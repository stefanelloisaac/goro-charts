import { describe, it, expect } from 'vitest';
import { MonotonicExtent } from '../monotonic-extent';

describe('MonotonicExtent', () => {
  it('retorna min/max corretos para sequência crescente', () => {
    const ext = new MonotonicExtent(10);
    for (let i = 0; i < 5; i++) ext.push(i, i, 0);
    expect(ext.min).toBe(0);
    expect(ext.max).toBe(4);
  });

  it('retorna min/max corretos para sequência decrescente', () => {
    const ext = new MonotonicExtent(10);
    for (let i = 5; i >= 0; i--) ext.push(i, 5 - i, 0);
    expect(ext.min).toBe(0);
    expect(ext.max).toBe(5);
  });

  it('retorna min/max corretos para valores idênticos', () => {
    const ext = new MonotonicExtent(10);
    for (let i = 0; i < 10; i++) ext.push(42, i, 0);
    expect(ext.min).toBe(42);
    expect(ext.max).toBe(42);
  });

  it('expira valores antigos quando a janela desliza', () => {
    const ext = new MonotonicExtent(3);
    ext.push(10, 0, 0);
    ext.push(20, 1, 0);
    ext.push(5, 2, 0);
    expect(ext.min).toBe(5);
    expect(ext.max).toBe(20);

    // seq=3, windowStart=1 → seq 0 expira
    ext.push(15, 3, 1);
    expect(ext.min).toBe(5);
    expect(ext.max).toBe(20);

    // seq=4, windowStart=2 → seq 0 e 1 expiram
    ext.push(25, 4, 2);
    expect(ext.min).toBe(5);
    expect(ext.max).toBe(25);
  });

  it('funciona com valores aleatórios grandes', () => {
    const ext = new MonotonicExtent(1000);
    const vals: number[] = [];
    for (let i = 0; i < 500; i++) {
      const v = Math.random() * 1000;
      vals.push(v);
      ext.push(v, i, 0);
    }
    const expectedMin = Math.min(...vals);
    const expectedMax = Math.max(...vals);
    expect(ext.min).toBe(expectedMin);
    expect(ext.max).toBe(expectedMax);
  });

  it('reset corretamente com clear()', () => {
    const ext = new MonotonicExtent(10);
    ext.push(10, 0, 0);
    ext.push(20, 1, 0);
    ext.clear();
    // após clear, min/max são lidos de posições inválidas, mas isso
    // só ocorre se count > 0 for verificado antes de chamar min/max
    ext.push(99, 0, 0);
    expect(ext.min).toBe(99);
    expect(ext.max).toBe(99);
  });

  it('mantém a deque com capacidade exata (wrap-around)', () => {
    const ext = new MonotonicExtent(4);
    ext.push(10, 0, 0);
    ext.push(20, 1, 0);
    ext.push(5, 2, 0);
    ext.push(30, 3, 0);

    // agora está cheio; windowStart sobe
    ext.push(15, 4, 1); // remove seq 0
    expect(ext.min).toBe(5);
    expect(ext.max).toBe(30);

    ext.push(25, 5, 2); // remove seq 1
    expect(ext.min).toBe(5);
    expect(ext.max).toBe(30);

    ext.push(1, 6, 3);
    expect(ext.min).toBe(1);
    expect(ext.max).toBe(30);
  });

  it('funciona com cap=1', () => {
    const ext = new MonotonicExtent(1);
    ext.push(100, 0, 0);
    expect(ext.min).toBe(100);
    expect(ext.max).toBe(100);

    ext.push(50, 1, 1);
    expect(ext.min).toBe(50);
    expect(ext.max).toBe(50);
  });

  it('lida com padrão alternado (max, min, max, min)', () => {
    const ext = new MonotonicExtent(10);
    for (let i = 0; i < 10; i++) {
      const v = i % 2 === 0 ? 100 : 0;
      ext.push(v, i, 0);
    }
    expect(ext.min).toBe(0);
    expect(ext.max).toBe(100);
  });
});
