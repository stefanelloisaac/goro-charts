/**
 * @file v1.9.0 render-pipeline tests: dirty flags, layer allocation, fast path,
 * tick cache integration, and crosshair-under-parsed-cursor in streaming.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LineChart, AreaChart } from '../../index.ts';

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.width = '400px';
  canvas.style.height = '200px';
  canvas.getBoundingClientRect = () =>
    ({ width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, x: 0, y: 0 }) as DOMRect;
  document.body.appendChild(canvas);
  return canvas;
}

describe('v1.9.0 — dirty flags', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('append só seta dirtyDomain + dirtySeries, não dirtyFrame', () => {
    const chart = new LineChart(canvas, { maxPoints: 100, autoDraw: false } as any);
    chart.draw();
    chart.append(0, 1, 50);
    expect((chart as any).dirtyDomain).toBe(true);
    expect((chart as any).dirtySeries).toBe(true);
    expect((chart as any).dirtyFrame).toBe(false);
  });

  it('appendBatch só seta dirtyDomain + dirtySeries', () => {
    const chart = new LineChart(canvas, { maxPoints: 100, autoDraw: false } as any);
    chart.draw();
    chart.appendBatch(0, new Float64Array([1, 2]) as any, new Float64Array([10, 20]) as any);
    expect((chart as any).dirtyDomain).toBe(true);
    expect((chart as any).dirtySeries).toBe(true);
    expect((chart as any).dirtyFrame).toBe(false);
  });

  it('appendFrame só seta dirtyDomain + dirtySeries', () => {
    const chart = new AreaChart(canvas, {
      series: [{ id: 'a' }, { id: 'b' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);
    chart.draw();
    chart.appendFrame(1, { a: 10, b: 20 });
    expect((chart as any).dirtyDomain).toBe(true);
    expect((chart as any).dirtySeries).toBe(true);
    expect((chart as any).dirtyFrame).toBe(false);
  });

  it('setData seta dirtyDomain + dirtyFrame + dirtySeries', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    chart.draw();
    chart.setData(0, new Float64Array([1, 2, 3]) as any, new Float64Array([10, 20, 30]) as any);
    expect((chart as any).dirtyDomain).toBe(true);
    expect((chart as any).dirtyFrame).toBe(true);
    expect((chart as any).dirtySeries).toBe(true);
  });

  it('setMaxPoints seta tudo', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    chart.draw();
    (chart as any).setMaxPoints(100);
    expect((chart as any).dirtyDomain).toBe(true);
    expect((chart as any).dirtyFrame).toBe(true);
    expect((chart as any).dirtySeries).toBe(true);
  });

  it('clear seta tudo', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    chart.draw();
    chart.clear();
    expect((chart as any).dirtyDomain).toBe(true);
    expect((chart as any).dirtyFrame).toBe(true);
    expect((chart as any).dirtySeries).toBe(true);
  });

  it('draw limpa dirty flags', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    chart.setData(0, new Float64Array([0, 1]) as any, new Float64Array([0, 1]) as any);
    chart.draw();
    expect((chart as any).dirtyDomain).toBe(false);
    expect((chart as any).dirtyFrame).toBe(false);
    expect((chart as any).dirtySeries).toBe(false);
  });

  it('paint-only setOptions seta só dirtyFrame', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    chart.draw();
    chart.setOptions({ textColor: '#ff0000' });
    expect((chart as any).dirtyDomain).toBe(false);
    expect((chart as any).dirtyFrame).toBe(true);
    expect((chart as any).dirtySeries).toBe(false);
  });

  it('structural setOptions seta tudo', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    chart.draw();
    chart.setOptions({ padding: [10, 10, 10, 10] });
    expect((chart as any).dirtyDomain).toBe(true);
    expect((chart as any).dirtyFrame).toBe(true);
    expect((chart as any).dirtySeries).toBe(true);
  });

  it('setOptions com estilo visual de série seta só dirtySeries', () => {
    const chart = new LineChart(canvas, {
      autoDraw: false,
      series: [{ id: 's', name: 'S', color: '#f00' }],
    } as any);
    chart.draw();
    chart.setOptions({ series: [{ id: 's', name: 'S', color: '#0f0' }] } as any);
    expect((chart as any).dirtyDomain).toBe(false);
    expect((chart as any).dirtyFrame).toBe(false);
    expect((chart as any).dirtySeries).toBe(true);
  });
});

describe('v1.9.0 — series layer condicional', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
  });
  afterEach(() => {
    canvas.remove();
  });

  it('estático não aloca series layer', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    expect((chart as any).surface.seriesLayerEnabled).toBe(false);
  });

  it('maxPoints > 0 aloca no construtor', () => {
    const chart = new LineChart(canvas, { maxPoints: 1000, autoDraw: false } as any);
    expect((chart as any).surface.seriesLayerEnabled).toBe(true);
    expect((chart as any).surface.seriesContext()).not.toBeNull();
  });

  it('setMaxPoints(n>0) aloca lazy', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    expect((chart as any).surface.seriesLayerEnabled).toBe(false);
    (chart as any).setMaxPoints(500);
    expect((chart as any).surface.seriesLayerEnabled).toBe(true);
  });

  it('setMaxPoints em ring existente não re-aloca', () => {
    const chart = new LineChart(canvas, { maxPoints: 100, autoDraw: false } as any);
    const spy = vi.spyOn((chart as any).surface, 'enableSeriesLayer');
    (chart as any).setMaxPoints(200);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('v1.9.0 — fast path', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });
  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('draw sem dados novos não chama renderFrameLayer nem renderSeriesLayer', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    chart.setData(0, new Float64Array([0, 1, 2, 3]) as any, new Float64Array([10, 20, 30, 40]) as any);
    chart.draw();
    const fs = vi.spyOn(chart as any, 'renderFrameLayer');
    const ss = vi.spyOn(chart as any, 'renderSeriesLayer');
    chart.draw();
    expect(fs).not.toHaveBeenCalled();
    expect(ss).not.toHaveBeenCalled();
    fs.mockRestore();
    ss.mockRestore();
  });

  it('append dentro do viewport não redesenha frame', () => {
    const chart = new LineChart(canvas, { maxPoints: 100, autoDraw: false } as any);
    for (let i = 0; i < 10; i++) chart.append(0, i, i * 10);
    chart.setViewport({ xMin: 2, xMax: 7, yAuto: false });
    chart.setOptions({ yMin: 0, yMax: 100 } as any);
    chart.draw();
    const fs = vi.spyOn(chart as any, 'renderFrameLayer');
    const ss = vi.spyOn(chart as any, 'renderSeriesLayer');
    chart.append(0, 10, 42);
    chart.draw();
    expect(fs).not.toHaveBeenCalled();
    expect(ss).toHaveBeenCalled();
    fs.mockRestore();
    ss.mockRestore();
  });

  it('múltiplos appends dentro do viewport skipam frame', () => {
    const chart = new LineChart(canvas, { maxPoints: 100, autoDraw: false } as any);
    for (let i = 0; i < 10; i++) chart.append(0, i, i * 10);
    chart.setViewport({ xMin: 2, xMax: 7, yAuto: false });
    chart.setOptions({ yMin: 0, yMax: 100 } as any);
    chart.draw();
    const fs = vi.spyOn(chart as any, 'renderFrameLayer');
    const ss = vi.spyOn(chart as any, 'renderSeriesLayer');
    chart.append(0, 10, 99);
    chart.draw();
    chart.append(0, 11, 88);
    chart.draw();
    expect(fs).not.toHaveBeenCalled();
    expect(ss).toHaveBeenCalledTimes(2);
    fs.mockRestore();
    ss.mockRestore();
  });

  it('domínio deslizou → frame redesenhado (sub-caminho reposicionamento)', () => {
    const chart = new LineChart(canvas, { maxPoints: 1000, autoDraw: false } as any);
    for (let i = 0; i < 10; i++) chart.append(0, i, i * 10);
    chart.draw();
    const fs = vi.spyOn(chart as any, 'renderFrameLayer');
    // Append que expande xMax → domínio se move
    chart.append(0, 100, 42);
    chart.draw();
    expect(fs).toHaveBeenCalled();
    fs.mockRestore();
  });
});
