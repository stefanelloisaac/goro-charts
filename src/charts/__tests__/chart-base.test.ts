import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LineChart } from '../../charts/line-chart.ts';
import { AreaChart } from '../../charts/area-chart.ts';
import { ScatterChart } from '../../charts/scatter-chart.ts';

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.width = '400px';
  canvas.style.height = '200px';
  canvas.getBoundingClientRect = () =>
    ({ width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, x: 0, y: 0 }) as DOMRect;
  document.body.appendChild(canvas);
  return canvas;
}

describe('LineChart', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('construtor cria chart com opções padrão', () => {
    const chart = new LineChart(canvas);
    expect(chart.seriesCount).toBe(1);
    expect(chart.pointCount(0)).toBe(0);
  });

  it('setData + draw: ciclo completo', () => {
    const chart = new LineChart(canvas);
    const x = new Float64Array([0, 1, 2, 3, 4]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20, 30, 40, 50]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    expect(chart.pointCount(0)).toBe(5);
    expect(chart.lastValue(0)).toBe(50);
  });

  it('append em ring mode', () => {
    const chart = new LineChart(canvas, { maxPoints: 100, autoDraw: false } as any);
    chart.append(0, 0, 100);
    expect(chart.pointCount(0)).toBe(1);
    expect(chart.lastValue(0)).toBe(100);
  });

  it('suspendDraw / resumeDraw: nesting', () => {
    const chart = new LineChart(canvas, { maxPoints: 10, autoDraw: true } as any);
    chart.suspendDraw();
    chart.suspendDraw();
    chart.append(0, 0, 100);
    chart.resumeDraw();
    expect(chart.pointCount(0)).toBe(1);
    chart.resumeDraw();
    // Após segundo resume, deve agendar draw
    expect(chart.pointCount(0)).toBe(1);
  });

  it('clear reseta dados', () => {
    const chart = new LineChart(canvas, { maxPoints: 10 } as any);
    chart.append(0, 0, 100);
    chart.clear();
    expect(chart.pointCount(0)).toBe(0);
  });

  it('toImage retorna string', () => {
    const chart = new LineChart(canvas);
    const img = chart.toImage();
    expect(typeof img).toBe('string');
    expect(img.startsWith('data:image/png')).toBe(true);
  });

  it('destroy é idempotente', () => {
    const chart = new LineChart(canvas);
    chart.destroy();
    expect(() => chart.destroy()).not.toThrow();
  });

  it('seriesCount retorna número correto', () => {
    const chart = new LineChart(canvas, { series: [{ name: 'A', color: '#f00' }, { name: 'B', color: '#0f0' }] } as any);
    expect(chart.seriesCount).toBe(2);
  });

  it('ring mode: extent acompanha a janela deslizante (encolhe quando pico sai)', () => {
    const chart = new LineChart(canvas, { maxPoints: 3, autoDraw: false } as any);
    // Enche a janela com um pico alto no início.
    chart.append(0, 0, 1000); // pico
    chart.append(0, 1, 10);
    chart.append(0, 2, 20);
    chart.draw();
    expect(chart.extentMax(0)).toBe(1000);
    // Desliza: o pico (x=0) sai da janela de 3 pontos.
    chart.append(0, 3, 30);
    chart.draw();
    // O extent deve ter encolhido — o pico não está mais visível.
    expect(chart.extentMax(0)).toBe(30);
    expect(chart.extentMax(0)).toBeLessThan(1000);
  });
});

describe('AreaChart', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
  });

  afterEach(() => {
    canvas.remove();
  });

  it('construtor cria chart', () => {
    const chart = new AreaChart(canvas);
    expect(chart.seriesCount).toBe(1);
  });
});

describe('ScatterChart', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
  });

  afterEach(() => {
    canvas.remove();
  });

  it('construtor cria chart', () => {
    const chart = new ScatterChart(canvas);
    expect(chart.seriesCount).toBe(1);
  });
});
