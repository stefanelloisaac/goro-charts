/**
 * @file Unit tests for the TickCache (v1.9.0).
 *
 * Verifies cache hit/miss logic, format signature drift, snapshot/keysChanged,
 * and dual-Y axis isolation.
 */

import { describe, it, expect } from 'vitest';
import { TickCache } from '../tick-cache.ts';
import type { Domain, ResolvedOpts } from '../../types.ts';

const BASE: Domain = { xMin: 0, xMax: 100, yMin: 0, yMax: 50 };

const BASE_OPTS = {
  xAxis: {
    type: 'linear' as const,
    timeZone: undefined as string | undefined,
    tickFormat: undefined as ((v: number) => string) | undefined,
  },
  yAxis: { tickFormat: undefined as ((v: number) => string) | undefined },
  xTicks: 5,
  yTicks: 5,
} as unknown as ResolvedOpts;

describe('TickCache', () => {
  it('primeiro refresh é sempre miss', () => {
    const cache = new TickCache();
    const r = cache.refresh(BASE, null, BASE_OPTS);
    expect(r.xChanged).toBe(true);
    expect(r.yLeftChanged).toBe(true);
    expect(r.yRightChanged).toBe(false); // sem dual-Y
  });

  it('segundo refresh com mesmo domínio é hit', () => {
    const cache = new TickCache();
    cache.refresh(BASE, null, BASE_OPTS);
    const r = cache.refresh(BASE, null, BASE_OPTS);
    expect(r.xChanged).toBe(false);
    expect(r.yLeftChanged).toBe(false);
  });

  it('domínio diferente → miss', () => {
    const cache = new TickCache();
    cache.refresh(BASE, null, BASE_OPTS);
    const D2: Domain = { xMin: 0, xMax: 200, yMin: 0, yMax: 100 };
    const r = cache.refresh(D2, null, BASE_OPTS);
    expect(r.xChanged).toBe(true);
    expect(r.yLeftChanged).toBe(true);
  });

  it('mesmo domínio mas tickFormat diferente → miss', () => {
    const cache = new TickCache();
    cache.refresh(BASE, null, BASE_OPTS);
    const opts2 = {
      ...BASE_OPTS,
      xAxis: { ...BASE_OPTS.xAxis, tickFormat: (v: number) => `${v}ms` },
    } as unknown as ResolvedOpts;
    const r = cache.refresh(BASE, null, opts2);
    expect(r.xChanged).toBe(true);
  });

  it('dual-Y: right axis isolado', () => {
    const cache = new TickCache();
    const right: Domain = { xMin: 0, xMax: 100, yMin: -10, yMax: 10 };
    const r1 = cache.refresh(BASE, right, BASE_OPTS);
    expect(r1.yRightChanged).toBe(true);

    const r2 = cache.refresh(BASE, right, BASE_OPTS);
    expect(r2.yRightChanged).toBe(false);
  });

  it('labels são strings formatadas', () => {
    const cache = new TickCache();
    cache.refresh(BASE, null, BASE_OPTS);
    expect(cache.xLabels.length).toBeGreaterThan(0);
    expect(cache.yLeftLabels.length).toBeGreaterThan(0);
    // Verifica que não há labels vazias (desde que haja ticks)
    expect(cache.xLabels.every((l) => l.length > 0)).toBe(true);
  });

  it('reutiliza labels por valor quando o conjunto de ticks muda parcialmente', () => {
    let calls = 0;
    const opts = {
      ...BASE_OPTS,
      xAxis: {
        ...BASE_OPTS.xAxis,
        tickFormat: (v: number) => {
          calls++;
          return `X${v}`;
        },
      },
    } as unknown as ResolvedOpts;
    const cache = new TickCache();
    cache.refresh({ ...BASE, xMin: 0, xMax: 100 }, null, opts);
    const firstCalls = calls;

    cache.refresh({ ...BASE, xMin: 20, xMax: 120 }, null, opts);

    expect(calls).toBeLessThan(firstCalls * 2);
    expect(calls).toBe(firstCalls + 1);
  });

  it('snapshotKeys + keysChanged', () => {
    const cache = new TickCache();
    cache.refresh(BASE, null, BASE_OPTS);
    const snap = cache.snapshotKeys();
    expect(cache.keysChanged(snap)).toBe(false);

    cache.invalidate();
    expect(cache.keysChanged(snap)).toBe(true);
  });

  it('invalidate força refresh completo no próximo refresh', () => {
    const cache = new TickCache();
    cache.refresh(BASE, null, BASE_OPTS);
    cache.invalidate();
    const r = cache.refresh(BASE, null, BASE_OPTS);
    expect(r.xChanged).toBe(true);
    expect(r.yLeftChanged).toBe(true);
  });
});
