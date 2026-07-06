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
    const chart = new LineChart(canvas, {
      series: [
        { name: 'A', color: '#f00' },
        { name: 'B', color: '#0f0' },
      ],
    } as any);
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

describe('yMin / yMax (sentinela undefined)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('yMin: 0 é preservado após setData', () => {
    const chart = new LineChart(canvas, { yMin: 0, autoDraw: false } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, -5, 20]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    // yMin=0 deve manter o grid ancorado em 0, não em -5
    expect(chart['gridDomainLeft'].yMin).toBe(0);
    expect(chart['gridDomainLeft'].yMax).toBe(20);
  });

  it('yMax: 0 é preservado após setData', () => {
    const chart = new LineChart(canvas, { yMax: 0, autoDraw: false } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([-10, -5, -20]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    // yMax=0 deve manter o grid ancorado em 0, não em -5
    expect(chart['gridDomainLeft'].yMax).toBe(0);
    expect(chart['gridDomainLeft'].yMin).toBe(-20);
  });

  it('domínio automático usa extent dos dados quando yMin/yMax são undefined', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    expect(chart['gridDomainLeft'].yMin).toBe(10);
    expect(chart['gridDomainLeft'].yMax).toBe(30);
  });

  it('yMin e yMax undefined caem em auto após setData', () => {
    const chart = new LineChart(canvas, { yMin: undefined, yMax: undefined, autoDraw: false } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([5, 15, 25]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    expect(chart['gridDomainLeft'].yMin).toBe(5);
  });

  it('intervalo negativo com yMin/yMax fixos funciona', () => {
    const chart = new LineChart(canvas, { yMin: -10, yMax: -1, autoDraw: false } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([-8, -5, -2]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    expect(chart['gridDomainLeft'].yMin).toBe(-10);
    expect(chart['gridDomainLeft'].yMax).toBe(-1);
  });

  it('configuração inválida yMin >= yMax gera aviso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chart = new LineChart(canvas, { yMin: 100, yMax: 50 } as any);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('yMin (100) must be < yMax (50)'));
    warn.mockRestore();
    // Após swap, o grid usa os valores trocados
    expect(chart['gridDomainLeft'].yMin).toBe(50);
    expect(chart['gridDomainLeft'].yMax).toBe(100);
  });
});

describe('Keyboard navigation (por ponto)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  function arrowKey(key: string, shift = false): void {
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true }));
  }

  it('ArrowRight posiciona cursor no primeiro ponto', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([100, 200, 300]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    chart['cursorLogical'] = -1;
    canvas.focus();
    arrowKey('ArrowRight');
    expect(chart['cursorLogical']).toBe(0);
    expect(chart['cursorX']).toBeGreaterThanOrEqual(0);
  });

  it('ArrowRight avança um ponto', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([100, 200, 300]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    canvas.focus();
    chart['cursorLogical'] = 0;
    arrowKey('ArrowRight');
    expect(chart['cursorLogical']).toBe(1);
  });

  it('ArrowLeft posiciona no último ponto quando cursor não iniciado', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([100, 200, 300]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    canvas.focus();
    chart['cursorLogical'] = -1;
    arrowKey('ArrowLeft');
    expect(chart['cursorLogical']).toBe(2);
  });

  it('ArrowLeft volta um ponto', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([100, 200, 300]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    canvas.focus();
    chart['cursorLogical'] = 1;
    arrowKey('ArrowLeft');
    expect(chart['cursorLogical']).toBe(0);
  });

  it('Shift+ArrowRight avança 10 pontos', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const xs = Array.from({ length: 20 }, (_, i) => i);
    const ys = Array.from({ length: 20 }, (_, i) => i * 10);
    const x = new Float64Array(xs) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array(ys) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    canvas.focus();
    chart['cursorLogical'] = 3;
    arrowKey('ArrowRight', true);
    expect(chart['cursorLogical']).toBe(13);
  });

  it('cursor não ultrapassa o último ponto', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([10, 20]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([100, 200]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    canvas.focus();
    chart['cursorLogical'] = 1;
    arrowKey('ArrowRight');
    expect(chart['cursorLogical']).toBe(1);
  });

  it('cursor não ultrapassa o primeiro ponto', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([10, 20]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([100, 200]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    canvas.focus();
    chart['cursorLogical'] = 0;
    arrowKey('ArrowLeft');
    expect(chart['cursorLogical']).toBe(0);
  });

  it('Escape esconde crosshair', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([10, 20]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([100, 200]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    canvas.focus();
    chart['cursorLogical'] = -1;
    arrowKey('ArrowRight');
    expect(chart['showCrosshair']).toBe(true);
    arrowKey('Escape');
    expect(chart['showCrosshair']).toBe(false);
  });
});

describe('prefers-reduced-motion', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  function mockMatchMedia(matches: boolean, listeners: Array<(e: MediaQueryListEvent) => void>) {
    const mql = {
      matches,
      addEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb)),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockReturnValue(mql);
    return { mql, listeners };
  }

  it('streaming continua atualizando com reduced-motion ativo', () => {
    mockMatchMedia(true, []);
    const chart = new LineChart(canvas, { maxPoints: 100, autoDraw: false } as any);
    expect(chart['reducedMotionMql']!.matches).toBe(true);
    chart.append(0, 0, 100);
    chart.draw();
    expect(chart.pointCount(0)).toBe(1);
    expect(chart.lastValue(0)).toBe(100);
    chart.append(0, 1, 200);
    chart.draw();
    expect(chart.pointCount(0)).toBe(2);
  });

  it('invalidate() desenha mesmo com reduced-motion ativo', () => {
    mockMatchMedia(true, []);
    const chart = new LineChart(canvas, { autoDraw: true } as any);

    // Fake that the chart is already dirty — invalidate should still schedule
    chart['dirty'] = false;
    const drawSpy = vi.spyOn(chart as any, 'draw').mockImplementation(() => {});
    chart['invalidate']();
    expect(chart['dirty']).toBe(true);

    drawSpy.mockRestore();
  });

  it('mudança de preferência em runtime dispara redraw', () => {
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    mockMatchMedia(false, listeners);
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    expect(listeners.length).toBe(1);

    const drawSpy = vi.spyOn(chart as any, 'draw').mockImplementation(() => {});
    const event = { matches: true } as MediaQueryListEvent;
    listeners[0](event);
    expect(drawSpy).toHaveBeenCalledTimes(1);
    drawSpy.mockRestore();
  });
});
