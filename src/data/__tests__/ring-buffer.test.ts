import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../ring-buffer';

describe('RingBuffer', () => {
  it('append até encher', () => {
    const r = new RingBuffer(5);
    for (let i = 0; i < 5; i++) r.push(i, i * 10);
    expect(r.count).toBe(5);
    expect(r.head).toBe(0);
    expect(r.xFirst).toBe(0);
    expect(r.xLast).toBe(4);
  });

  it('wrap-around (append > cap)', () => {
    const r = new RingBuffer(3);
    r.push(10, 100);
    r.push(20, 200);
    r.push(30, 300);
    r.push(40, 400); // deve sobrescrever o primeiro
    expect(r.count).toBe(3);
    expect(r.head).toBe(1); // o índice 0 foi sobrescrito
    expect(r.xFirst).toBe(20);
    expect(r.xLast).toBe(40);
    expect(r.physOf(0)).toBe(1); // logical 0 = physical head = 1
    expect(r.physOf(1)).toBe(2);
    expect(r.physOf(2)).toBe(0);
  });

  it('xFirst e xLast corretos com wrap-around total', () => {
    const r = new RingBuffer(4);
    r.push(1, 10);
    r.push(2, 20);
    r.push(3, 30);
    r.push(4, 40);
    r.push(5, 50); // head = 1
    r.push(6, 60); // head = 2
    expect(r.xFirst).toBe(3);
    expect(r.xLast).toBe(6);
  });

  it('yMin e yMax O(1) corretos', () => {
    const r = new RingBuffer(10);
    r.push(0, 50);
    r.push(1, 30);
    r.push(2, 80);
    r.push(3, 10);
    expect(r.yMin).toBe(10);
    expect(r.yMax).toBe(80);
  });

  it('resize maior preserva dados recentes', () => {
    const r = new RingBuffer(3);
    r.push(1, 10);
    r.push(2, 20);
    r.push(3, 30);
    r.push(4, 40); // head=1, [4,2,3]

    r.resize(10);
    expect(r.count).toBe(3);
    expect(r.cap).toBe(10);
    expect(r.xFirst).toBe(2);
    expect(r.xLast).toBe(4);
  });

  it('resize menor preserva os dados mais recentes', () => {
    const r = new RingBuffer(10);
    for (let i = 0; i < 10; i++) r.push(i, i * 100);
    r.push(10, 1000); // head = 1
    r.push(11, 1100); // head = 2

    r.resize(3);
    expect(r.count).toBe(3);
    expect(r.cap).toBe(3);
    expect(r.xFirst).toBe(9);
    expect(r.xLast).toBe(11);
  });

  it('resize igual não muda nada', () => {
    const r = new RingBuffer(5);
    r.push(1, 10);
    r.push(2, 20);
    r.resize(5);
    expect(r.count).toBe(2);
    expect(r.cap).toBe(5);
  });

  it('clear reseta tudo', () => {
    const r = new RingBuffer(5);
    r.push(1, 10);
    r.push(2, 20);
    r.clear();
    expect(r.count).toBe(0);
    expect(r.head).toBe(0);
  });

  it('physOf com wrap', () => {
    const r = new RingBuffer(4);
    r.push(1, 10);
    r.push(2, 20);
    r.push(3, 30);
    r.push(4, 40);
    r.push(5, 50); // head=1
    expect(r.physOf(0)).toBe(1);
    expect(r.physOf(1)).toBe(2);
    expect(r.physOf(2)).toBe(3);
    expect(r.physOf(3)).toBe(0);
  });
});
