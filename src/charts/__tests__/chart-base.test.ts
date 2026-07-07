import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LineChart } from '../../charts/line-chart.ts';
import { AreaChart } from '../../charts/area-chart.ts';
import { ScatterChart } from '../../charts/scatter-chart.ts';
import { xToPx } from '../../math/scale.ts';

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

  it('série vazia (nunca setada) não quebra o draw / a escala', () => {
    // §4.9: "arrays vazios não quebram escalas" — uma série com count 0 é
    // ignorada em todo o pipeline de domínio; draw() não deve lançar.
    const chart = new LineChart(canvas);
    expect(chart.pointCount(0)).toBe(0);
    expect(() => chart.draw()).not.toThrow();
  });

  it('draw com apenas parte das séries populadas não quebra a escala', () => {
    const chart = new LineChart(canvas, {
      series: [
        { name: 'A', color: '#f00' },
        { name: 'B', color: '#0f0' },
      ],
    } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y); // série 1 fica vazia
    expect(() => chart.draw()).not.toThrow();
    expect(chart.pointCount(0)).toBe(3);
    expect(chart.pointCount(1)).toBe(0);
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

describe('Crosshair sync por valor', () => {
  let canvasA: HTMLCanvasElement;
  let canvasB: HTMLCanvasElement;

  beforeEach(() => {
    canvasA = document.createElement('canvas');
    canvasA.style.cssText = 'width:400px;height:200px';
    canvasA.getBoundingClientRect = () =>
      ({ width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, x: 0, y: 0 }) as DOMRect;
    document.body.appendChild(canvasA);

    canvasB = document.createElement('canvas');
    canvasB.style.cssText = 'width:600px;height:200px';
    canvasB.getBoundingClientRect = () =>
      ({ width: 600, height: 200, top: 0, left: 0, right: 600, bottom: 200, x: 0, y: 0 }) as DOMRect;
    document.body.appendChild(canvasB);

    vi.useFakeTimers();
  });

  afterEach(() => {
    canvasA.remove();
    canvasB.remove();
    vi.useRealTimers();
  });

  it('gráficos de tamanhos diferentes sincronizam por valor', () => {
    const chartA = new LineChart(canvasA, { series: [{ name: 'A', color: '#f00' }], autoDraw: false } as any);
    const chartB = new LineChart(canvasB, { series: [{ name: 'B', color: '#0f0' }], autoDraw: false } as any);

    // Mesmo dataset nos dois charts
    const x = new Float64Array([0, 50, 100]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([0, 100, 50]) as unknown as Float64Array<ArrayBufferLike>;
    chartA.setData(0, x, y);
    chartA.draw();
    chartB.setData(0, x, y);
    chartB.draw();

    chartA.sync(chartB);

    // Simula mouse no chartA no valor X = 50 (meio do domínio [0, 100])
    const plotA = chartA['plotRect']();
    const xPxA = xToPx(50, chartA['gridDomainLeft'], plotA);
    chartA['cursorX'] = xPxA;
    chartA['cursorY'] = plotA.y + 10; // dentro do plot para passar na validação
    chartA['notifySyncCrosshair']();

    // chartB deve ter um cursorX que corresponde ao valor 50 no seu domínio
    // (em pixels diferentes, porque as larguras são diferentes)
    const plotB = chartB['plotRect']();
    const xPxB = xToPx(50, chartB['gridDomainLeft'], plotB);
    expect(chartB['cursorX']).toBe(xPxB);
    expect(chartB['showCrosshair']).toBe(true);
  });

  it('valor fora do domínio é clampado na borda (não esconde)', () => {
    const chartA = new LineChart(canvasA, { series: [{ name: 'A', color: '#f00' }], autoDraw: false } as any);
    const chartB = new LineChart(canvasB, { series: [{ name: 'B', color: '#0f0' }], autoDraw: false } as any);

    const x = new Float64Array([0, 50, 100]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([0, 100, 50]) as unknown as Float64Array<ArrayBufferLike>;
    chartA.setData(0, x, y);
    chartA.draw();
    chartB.setData(0, x, y);
    chartB.draw();

    chartA.sync(chartB);

    // Valor 999 > xMax=100 — deve ser clampado para xMax=100 em vez de esconder.
    chartA['injectCursor'](999);
    expect(chartA['showCrosshair']).toBe(true);
    const expectedPx = xToPx(100, chartA['gridDomainLeft'], chartA['plotRect']());
    expect(chartA['cursorX']).toBe(expectedPx);

    // Valor -50 < xMin=0 — deve ser clampado para xMin=0.
    chartA['injectCursor'](-50);
    expect(chartA['showCrosshair']).toBe(true);
    const expectedPxMin = xToPx(0, chartA['gridDomainLeft'], chartA['plotRect']());
    expect(chartA['cursorX']).toBe(expectedPxMin);

    // O peer não é afetado diretamente (injectCursor não notifica peers).
    expect(chartB['showCrosshair']).toBe(false);
  });

  it('unsync() remove sincronização', () => {
    const chartA = new LineChart(canvasA, { series: [{ name: 'A', color: '#f00' }], autoDraw: false } as any);
    const chartB = new LineChart(canvasB, { series: [{ name: 'B', color: '#0f0' }], autoDraw: false } as any);

    chartA.sync(chartB);
    expect(chartA['syncTargets'].has(chartB)).toBe(true);
    expect(chartB['syncTargets'].has(chartA)).toBe(true);

    chartA.unsync(chartB);
    expect(chartA['syncTargets'].has(chartB)).toBe(false);
    expect(chartB['syncTargets'].has(chartA)).toBe(false);
  });

  it('destroy não deixa referência pendente nos peers', () => {
    const chartA = new LineChart(canvasA, { series: [{ name: 'A', color: '#f00' }], autoDraw: false } as any);
    const chartB = new LineChart(canvasB, { series: [{ name: 'B', color: '#0f0' }], autoDraw: false } as any);

    chartA.sync(chartB);
    chartB.destroy();

    // chartA não deve mais ter chartB nos syncTargets
    expect(chartA['syncTargets'].has(chartB)).toBe(false);
    expect(chartA['syncTargets'].size).toBe(0);
  });
});

describe('Stacking (contrato e validação)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:400px;height:200px';
    canvas.getBoundingClientRect = () =>
      ({ width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, x: 0, y: 0 }) as DOMRect;
    document.body.appendChild(canvas);
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('séries de eixos diferentes com mesmo stack geram aviso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new AreaChart(canvas, {
      series: [
        { name: 'A', color: '#f00', stack: 'g1' },
        { name: 'B', color: '#0f0', stack: 'g1', yAxis: 'right' },
      ],
      autoDraw: false,
    } as any);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mixes axis'));
    warn.mockRestore();
  });

  it('séries com count diferente geram aviso no accumulate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chart = new AreaChart(canvas, {
      series: [
        { name: 'A', color: '#f00', stack: 'g1' },
        { name: 'B', color: '#0f0', stack: 'g1' },
      ],
      autoDraw: false,
    } as any);
    const xA = new Float64Array([0, 1]) as unknown as Float64Array<ArrayBufferLike>;
    const yA = new Float64Array([10, 20]) as unknown as Float64Array<ArrayBufferLike>;
    const xB = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const yB = new Float64Array([5, 10, 15]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, xA, yA);
    chart.setData(1, xB, yB);
    chart.draw();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped series'));
    warn.mockRestore();
  });

  it('aviso de count desalinhado não repete a cada draw', () => {
    const chart = new AreaChart(canvas, {
      series: [
        { name: 'A', color: '#f00', stack: 'g1' },
        { name: 'B', color: '#0f0', stack: 'g1' },
      ],
      autoDraw: false,
    } as any);
    const xA = new Float64Array([0, 1]) as unknown as Float64Array<ArrayBufferLike>;
    const yA = new Float64Array([10, 20]) as unknown as Float64Array<ArrayBufferLike>;
    const xB = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const yB = new Float64Array([5, 10, 15]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, xA, yA);
    chart.setData(1, xB, yB);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chart.draw();
    chart['dirty'] = true;
    chart.draw();
    chart['dirty'] = true;
    chart.draw();
    // Apesar de 3 draws, o aviso de desalinhamento aparece uma única vez.
    const skipCalls = warn.mock.calls.filter((c) => String(c[0]).includes('skipped series'));
    expect(skipCalls.length).toBe(1);
    warn.mockRestore();
  });

  it('positivos e negativos são acumulados separadamente', () => {
    const chart = new AreaChart(canvas, {
      series: [
        { name: 'A', color: '#f00', stack: 'g1' },
        { name: 'B', color: '#0f0', stack: 'g1' },
      ],
      autoDraw: false,
    } as any);
    // Série A: positiva; Série B: negativa
    const x = new Float64Array([0, 1]) as unknown as Float64Array<ArrayBufferLike>;
    const yA = new Float64Array([10, 20]) as unknown as Float64Array<ArrayBufferLike>;
    const yB = new Float64Array([-5, -8]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, yA);
    chart.setData(1, x, yB);
    chart.draw();

    // A acumulação deve manter separados: posCum = [10, 20], negCum = [-5, -8]
    const { posCum, negCum } = chart['accumulateStackGroup']([0, 1]);
    expect(posCum).not.toBeNull();
    expect(negCum).not.toBeNull();
    expect(Array.from(posCum!)).toEqual([10, 20]);
    expect(Array.from(negCum!)).toEqual([-5, -8]);
  });

  it('mesmo eixo empilha sem aviso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new AreaChart(canvas, {
      series: [
        { name: 'A', color: '#f00', stack: 'g1' },
        { name: 'B', color: '#0f0', stack: 'g1' },
      ],
      autoDraw: false,
    } as any);
    // Reseta chamadas acumuladas durante a construção (pode haver warnings
    // de outras fontes como matchMedia mock) e verifica que não há aviso
    // relacionado a stacking.
    warn.mockClear();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('stack'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('mixes axis'));
    warn.mockRestore();
  });
});

describe('Métricas (windowPointCount / drawnPointCount)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:400px;height:200px';
    canvas.getBoundingClientRect = () =>
      ({ width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, x: 0, y: 0 }) as DOMRect;
    document.body.appendChild(canvas);
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('windowPointCount = soma dos counts', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    expect(chart.windowPointCount).toBe(3);
  });

  it('drawnPointCount = windowPointCount para dados esparsos (count <= 2*plotW)', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    // Canvas width = 400, plotW ~= 400 - 56 - 16 = 328; 2*plotW = 656
    const n = 100;
    const x = new Float64Array(Array.from({ length: n }, (_, i) => i)) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array(Array.from({ length: n }, (_, i) => i * 10)) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    expect(chart.drawnPointCount).toBe(100);
    expect(chart.drawnPointCount).toBe(chart.windowPointCount);
  });

  it('drawnPointCount << windowPointCount sob decimação (count > 2*plotW)', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    // 10000 pontos em ~328px de largura → decimação ativa
    const n = 10_000;
    const x = new Float64Array(Array.from({ length: n }, (_, i) => i)) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array(Array.from({ length: n }, (_, i) => i)) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    expect(chart.windowPointCount).toBe(10_000);
    expect(chart.drawnPointCount).toBeLessThan(10_000);
    // Deve estar próximo de ceil(2 * plotW)
    const plotW = chart['plotRect']().w;
    expect(chart.drawnPointCount).toBe(Math.ceil(plotW * 2));
  });
});

describe('README examples (verifiable)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('streaming example: LineChart com maxPoints + autoDraw + append em loop', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'CPU', color: '#4ea8ff' }],
      maxPoints: 10,
      autoDraw: true,
    } as any);
    for (let t = 0; t < 15; t++) chart.append(0, t, Math.random() * 100);
    expect(chart.pointCount(0)).toBe(10); // janela deslizante
  });

  it('sync example: chart1.sync(chart2) bidirecional', () => {
    const canvas2 = createCanvas();
    const chart1 = new LineChart(canvas, { autoDraw: false } as any);
    const chart2 = new LineChart(canvas2, { autoDraw: false } as any);

    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart1.setData(0, x, y);
    chart1.draw();
    chart2.setData(0, x, y);
    chart2.draw();

    chart1.sync(chart2);
    expect(chart1['syncTargets'].has(chart2)).toBe(true);
    expect(chart2['syncTargets'].has(chart1)).toBe(true);

    canvas2.remove();
    chart2.destroy();
    chart1.destroy();
  });

  it('erros de validação incluem índice da série', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    const xBad = new Float64Array([0, 1, 0]) as unknown as Float64Array<ArrayBufferLike>; // não-monotônico
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    expect(() => chart.setData(0, xBad, y)).toThrow('series 0');
  });

  it('injectCursor define cursorY válido e showCrosshair=true no alvo', () => {
    const targetCanvas = createCanvas();
    const chartA = new LineChart(canvas, { series: [{ name: 'A', color: '#f00' }], autoDraw: false } as any);
    const chartB = new LineChart(targetCanvas, { series: [{ name: 'B', color: '#0f0' }], autoDraw: false } as any);

    const x = new Float64Array([0, 50, 100]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 60, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chartA.setData(0, x, y);
    chartA.draw();
    chartB.setData(0, x, y);
    chartB.draw();

    chartA.sync(chartB);

    chartB['injectCursor'](50);

    expect(chartB['showCrosshair']).toBe(true);
    // cursorY must have been set (was -1 before the fix)
    expect(chartB['cursorY']).not.toBe(-1);
    expect(Number.isFinite(chartB['cursorY'])).toBe(true);

    targetCanvas.remove();
    chartA.destroy();
    chartB.destroy();
  });

  it('injectCursor em AreaChart stacked define cursorY dentro do plot', () => {
    const targetCanvas = createCanvas();
    const chartA = new LineChart(canvas, { series: [{ name: 'A', color: '#f00' }], autoDraw: false } as any);
    const chartB = new AreaChart(targetCanvas, {
      series: [
        { name: 'User', color: '#00f', stack: 'r', fillColor: '#00f', fillOpacity: 0.1 },
        { name: 'Sys', color: '#0f0', stack: 'r', fillColor: '#0f0', fillOpacity: 0.1 },
      ],
      autoDraw: false,
    } as any);

    const x = new Float64Array([0, 50, 100]) as unknown as Float64Array<ArrayBufferLike>;
    const y1 = new Float64Array([4000, 5000, 6000]) as unknown as Float64Array<ArrayBufferLike>;
    const y2 = new Float64Array([2000, 3000, 4000]) as unknown as Float64Array<ArrayBufferLike>;
    chartA.setData(0, x, y1);
    chartA.draw();
    chartB.setData(0, x, y1);
    chartB.setData(1, x, y2);
    chartB.draw();

    chartA.sync(chartB);

    chartB['injectCursor'](50);

    expect(chartB['showCrosshair']).toBe(true);
    // cursorY must be inside the plot rect so renderCrosshair doesn't bail.
    const plot = chartB['plotRect']();
    expect(chartB['cursorY']).toBeGreaterThanOrEqual(plot.y);
    expect(chartB['cursorY']).toBeLessThanOrEqual(plot.y + plot.h);

    targetCanvas.remove();
    chartA.destroy();
    chartB.destroy();
  });

  it('injectCursor em AreaChart stacked com ring buffer wrap mantém cursorY no plot', () => {
    const targetCanvas = createCanvas();
    const chartB = new AreaChart(targetCanvas, {
      series: [
        { name: 'User', color: '#00f', stack: 'r', fillColor: '#00f', fillOpacity: 0.1 },
        { name: 'Sys', color: '#0f0', stack: 'r', fillColor: '#0f0', fillOpacity: 0.1 },
      ],
      maxPoints: 3, // ring wraps after 3 points
      autoDraw: false,
    } as any);

    // Feed 5 points so the ring wraps (head !== 0).
    for (let i = 0; i < 5; i++) {
      chartB.append(0, i, 1000 + i * 100);
      chartB.append(1, i, 500 + i * 50);
    }
    chartB.draw();

    chartB['injectCursor'](2); // middle of [0, 4]

    expect(chartB['showCrosshair']).toBe(true);
    const plot = chartB['plotRect']();
    expect(chartB['cursorY']).toBeGreaterThanOrEqual(plot.y);
    expect(chartB['cursorY']).toBeLessThanOrEqual(plot.y + plot.h);

    targetCanvas.remove();
    chartB.destroy();
  });

  it('injectCursorLeave limpa crosshair via crosshairPainted sem esperar tick', () => {
    const chart = new LineChart(canvas, { series: [{ name: 'A', color: '#f00' }], autoDraw: false } as any);
    const x = new Float64Array([0, 50]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 60]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    chart['showCrosshair'] = true;
    chart['crosshairPainted'] = true; // simula que crosshair foi pintado no último draw

    chart['injectCursorLeave']();

    // Depois de injectCursorLeave: showCrosshair deve ser false e crosshairPainted limpo
    expect(chart['showCrosshair']).toBe(false);
    expect(chart['crosshairPainted']).toBe(false);
  });
});
