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
    chart['dirtyLayout'] = false;
    const drawSpy = vi.spyOn(chart as any, 'draw').mockImplementation(() => {});
    chart['invalidate']();
    expect(chart['dirtyLayout']).toBe(true);

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
    chart['dirtyLayout'] = true;
    chart.draw();
    chart['dirtyLayout'] = true;
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

describe('Identificadores de série (id)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  function seed(chart: LineChart, ref: number | string): void {
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(ref, x, y);
  }

  it('métodos aceitam id em vez de índice', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'cpu', name: 'CPU', color: '#f00' },
        { id: 'mem', name: 'MEM', color: '#0f0' },
      ],
      autoDraw: false,
    } as any);

    seed(chart, 'cpu');
    seed(chart, 'mem');

    expect(chart.pointCount('cpu')).toBe(3);
    expect(chart.lastValue('mem')).toBe(30);
    // O id resolve para o mesmo store que o índice.
    expect(chart.pointCount('mem')).toBe(chart.pointCount(1));
  });

  it('id duplicado é rejeitado na construção', () => {
    expect(
      () =>
        new LineChart(canvas, {
          series: [
            { id: 'dup', name: 'A', color: '#f00' },
            { id: 'dup', name: 'B', color: '#0f0' },
          ],
          autoDraw: false,
        } as any),
    ).toThrow('duplicate series id "dup"');
  });

  it('id desconhecido gera erro com o id', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'cpu', name: 'CPU', color: '#f00' }],
      autoDraw: false,
    } as any);
    expect(() => seed(chart, 'ghost')).toThrow('series id "ghost" not found');
  });

  it('mensagens de erro exibem o id', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'cpu', name: 'CPU', color: '#f00' }],
      autoDraw: false,
    } as any);
    const xBad = new Float64Array([0, 1, 0]) as unknown as Float64Array<ArrayBufferLike>; // não-monotônico
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    expect(() => chart.setData('cpu', xBad, y)).toThrow('series "cpu"');
  });

  it('índice fora de faixa continua sendo rejeitado', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00' }],
      autoDraw: false,
    } as any);
    const x = new Float64Array([0, 1]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20]) as unknown as Float64Array<ArrayBufferLike>;
    expect(() => chart.setData(5, x, y)).toThrow('out of range');
  });
});

describe('setOptions (atualização dinâmica)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  function seed(chart: LineChart): void {
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
  }

  it('alterar cor (visual) não recalcula o domínio', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00' }],
      autoDraw: false,
    } as any);
    seed(chart);
    const before = { ...chart['gridDomainLeft'] };

    chart.setOptions({ crosshairColor: '#123456' });

    expect(chart['gridDomainLeft']).toEqual(before);
    expect(chart['gridPinned']).toBe(true); // não foi desanexado
  });

  it('alterar chave estrutural recalcula o layout', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00' }],
      autoDraw: false,
    } as any);
    seed(chart);

    chart.setOptions({ padding: [0, 0, 0, 0] });

    // gridPinned volta a false até o próximo draw reancorar.
    expect(chart['gridPinned']).toBe(false);
  });

  it('substituir series com tamanho diferente é rejeitado', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00' }],
      autoDraw: false,
    } as any);
    expect(() =>
      chart.setOptions({
        series: [
          { name: 'A', color: '#f00' },
          { name: 'B', color: '#0f0' },
        ],
      }),
    ).toThrow('use addSeries/removeSeries');
  });
});

describe('Add / remove / show / hide de séries', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('addSeries adiciona uma série em runtime', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      autoDraw: false,
    } as any);

    const idx = chart.addSeries({ id: 'b', name: 'B', color: '#0f0' });

    expect(idx).toBe(1);
    expect(chart.seriesCount).toBe(2);
    const x = new Float64Array([0, 1]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([5, 6]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData('b', x, y);
    expect(chart.lastValue('b')).toBe(6);
  });

  it('addSeries preserva o modo ring (maxPoints)', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00' }],
      maxPoints: 3,
      autoDraw: false,
    } as any);
    const idx = chart.addSeries({ name: 'B', color: '#0f0' });
    // append só funciona em modo ring; não deve lançar.
    expect(() => chart.append(idx, 0, 10)).not.toThrow();
  });

  it('addSeries com id duplicado é rejeitado', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      autoDraw: false,
    } as any);
    expect(() => chart.addSeries({ id: 'a', name: 'dup', color: '#0f0' })).toThrow('duplicate series id "a"');

    // O erro deve ser atômico: a série duplicada não é anexada e o id-map
    // permanece íntegro para mutações futuras.
    expect(chart.seriesCount).toBe(1);
    expect(() => chart.addSeries({ id: 'b', name: 'B', color: '#0f0' })).not.toThrow();
    expect(chart.seriesCount).toBe(2);
    expect(chart.pointCount('b')).toBe(0);
  });

  it('removeSeries remove e reindexa', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      autoDraw: false,
    } as any);
    const x = new Float64Array([0, 1]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([5, 6]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData('a', x, y);
    chart.setData('b', x, y);

    chart.removeSeries('a');

    expect(chart.seriesCount).toBe(1);
    // 'b' agora está no índice 0 e continua acessível por id.
    expect(chart.pointCount('b')).toBe(2);
    expect(chart.pointCount(0)).toBe(2);
    // 'a' não existe mais.
    expect(() => chart.pointCount('a')).toThrow('series id "a" not found');
  });

  it('hideSeries exclui a série do domínio', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'lo', name: 'LO', color: '#f00' },
        { id: 'hi', name: 'HI', color: '#0f0' },
      ],
      autoDraw: false,
    } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData('lo', x, new Float64Array([0, 1, 2]) as any);
    chart.setData('hi', x, new Float64Array([100, 200, 300]) as any);
    chart.draw();

    const maxWithHi = chart['gridDomainLeft'].yMax;
    chart.hideSeries('hi');
    chart.draw();
    const maxWithoutHi = chart['gridDomainLeft'].yMax;

    expect(maxWithoutHi).toBeLessThan(maxWithHi);
  });

  it('showSeries restaura a série ao domínio', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'lo', name: 'LO', color: '#f00' },
        { id: 'hi', name: 'HI', color: '#0f0' },
      ],
      autoDraw: false,
    } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData('lo', x, new Float64Array([0, 1, 2]) as any);
    chart.setData('hi', x, new Float64Array([100, 200, 300]) as any);
    chart.hideSeries('hi');
    chart.draw();

    chart.showSeries('hi');
    chart.draw();

    expect(chart['gridDomainLeft'].yMax).toBeGreaterThanOrEqual(300);
  });

  it('legendConfigs omite séries ocultas mas mantém séries sem dados', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
        { id: 'c', name: 'C', color: '#00f' },
      ],
      autoDraw: false,
    } as any);
    const x = new Float64Array([0, 1]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([5, 6]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData('a', x, y);
    chart.setData('b', x, y);

    expect(chart['legendConfigs']().map((c: { id?: string }) => c.id)).toEqual(['a', 'b', 'c']);

    chart.hideSeries('b');

    expect(chart['legendConfigs']().map((c: { id?: string }) => c.id)).toEqual(['a', 'c']);
  });

  it('série oculta não gera hit no crosshair', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      autoDraw: false,
    } as any);
    const x = new Float64Array([0, 50, 100]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData('a', x, new Float64Array([10, 20, 30]) as any);
    chart.setData('b', x, new Float64Array([40, 50, 60]) as any);
    chart.draw();
    chart.hideSeries('b');

    // Validamos os hits pelo callback onHover disparado no draw do crosshair.
    const plot = chart['plotRect']();
    let captured: { label: string }[] = [];
    chart.onHover = (h) => (captured = h);
    chart['cursorX'] = plot.x + plot.w / 2;
    chart['cursorY'] = plot.y + plot.h / 2;
    chart['showCrosshair'] = true;
    chart['dirtyLayout'] = true;
    chart.draw();

    expect(captured.some((h) => h.label === 'B')).toBe(false);
    expect(captured.some((h) => h.label === 'A')).toBe(true);
  });
});

describe('batch (operações em lote)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('agrupa mutações em um único frame', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: true,
    } as any);

    const drawSpy = vi.spyOn(chart, 'draw');
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');

    chart.batch(() => {
      chart.append(0, 0, 1);
      chart.append(0, 1, 2);
      chart.append(0, 2, 3);
    });

    // Durante o batch nada desenha; ao sair, uma única rAF é agendada.
    expect(drawSpy).not.toHaveBeenCalled();
    expect(rafSpy).toHaveBeenCalledTimes(1);

    rafSpy.mockRestore();
    drawSpy.mockRestore();
  });

  it('resume mesmo se o callback lançar', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00' }],
      autoDraw: false,
    } as any);

    expect(() =>
      chart.batch(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    // suspendCount deve ter voltado a 0 (finally).
    expect(chart['suspendCount']).toBe(0);
  });
});

describe('appendFrame (v1.5.0)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('atualiza múltiplas séries atomicamente no mesmo x', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, { a: 10, b: 20 });
    chart.appendFrame(1, { a: 11, b: 21 });

    expect(chart.lastValue('a')).toBe(11);
    expect(chart.lastValue('b')).toBe(21);
    expect(chart.pointCount('a')).toBe(2);
    expect(chart.pointCount('b')).toBe(2);
  });

  it('série ausente com dado anterior recebe carry-forward', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, { a: 10, b: 20 });
    // Só 'a' recebe novo dado; 'b' deve receber carry-forward de 20.
    chart.appendFrame(1, { a: 11 });

    expect(chart.lastValue('a')).toBe(11);
    expect(chart.lastValue('b')).toBe(20);
    expect(chart.pointCount('a')).toBe(2);
    expect(chart.pointCount('b')).toBe(2); // carry-forward manteve alinhamento
  });

  it('série nunca inicializada não recebe carry-forward', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, { a: 10 });
    chart.appendFrame(1, { a: 11 });

    // 'b' nunca recebeu dado — deve continuar vazia.
    expect(chart.pointCount('b')).toBe(0);
  });

  it('série oculta com dados permanece alinhada (carry-forward)', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, { a: 10, b: 20 });
    chart.hideSeries('b');
    chart.appendFrame(1, { a: 11 }); // 'b' está oculta, mas recebe carry-forward

    // Ao mostrar 'b' de novo, deve ter 2 pontos alinhados.
    chart.showSeries('b');
    expect(chart.pointCount('b')).toBe(2);
    expect(chart.lastValue('b')).toBe(20);
  });

  it('refs duplicadas para a mesma série são rejeitadas', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    // Map com índice 0 e id 'a' resolvem para a mesma série.
    expect(() => {
      const m = new Map<number | string, number>();
      m.set(0, 10);
      m.set('a', 15);
      chart.appendFrame(0, m);
    }).toThrow('duplicate series ref');
  });

  it('ref inválido não muta nenhuma série (atômico)', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, { a: 10 });

    expect(() => chart.appendFrame(1, { a: 11, x: 99 } as any)).toThrow();

    // Nenhuma série foi alterada pelo frame que falhou.
    expect(chart.pointCount('a')).toBe(1);
    expect(chart.lastValue('a')).toBe(10);
    expect(chart.pointCount('b')).toBe(0);
  });

  it('x não finito lança sem mutar', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    expect(() => chart.appendFrame(NaN, { a: 10 })).toThrow('not finite');
    expect(() => chart.appendFrame(Infinity, { a: 10 })).toThrow('not finite');
    expect(chart.pointCount('a')).toBe(0);
  });

  it('y não finito lança sem mutar nenhuma série', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, { a: 10, b: 20 });

    expect(() => chart.appendFrame(1, { a: Infinity, b: 25 })).toThrow('not finite');

    // Nenhuma série foi alterada.
    expect(chart.lastValue('a')).toBe(10);
    expect(chart.lastValue('b')).toBe(20);
    expect(chart.pointCount('a')).toBe(1);
  });

  it('y = NaN é aceito (reservado para gaps v1.6.0)', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    expect(() => chart.appendFrame(0, { a: NaN })).not.toThrow();
    expect(chart.pointCount('a')).toBe(1);
  });

  it('x não monotônico lança', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(5, { a: 10 });
    expect(() => chart.appendFrame(3, { a: 11 })).toThrow('monotonically increasing');
  });

  it('ring buffer mantém counts alinhados após overflow', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 3,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, { a: 10, b: 20 });
    chart.appendFrame(1, { a: 11 });
    chart.appendFrame(2, { a: 12, b: 22 });
    chart.appendFrame(3, { a: 13 });
    chart.appendFrame(4, { a: 14, b: 24 });

    // Janela de 3 pontos: ambas as séries devem ter 3 amostras alinhadas.
    expect(chart.pointCount('a')).toBe(3);
    expect(chart.pointCount('b')).toBe(3);
  });

  it('uma chamada com autoDraw agenda no máximo um rAF', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: true,
    } as any);

    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    chart.appendFrame(0, { a: 10, b: 20 });

    expect(rafSpy).toHaveBeenCalledTimes(1);
    rafSpy.mockRestore();
  });

  it('autoDraw false não agenda rAF', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    chart.appendFrame(0, { a: 10 });

    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('frame vazio não altera estado', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, {});

    expect(chart.pointCount('a')).toBe(0);
  });

  it('aceita Map<SeriesRef, number> com índices numéricos', () => {
    const chart = new LineChart(canvas, {
      series: [
        { name: 'A', color: '#f00' },
        { name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    const m = new Map<number, number>();
    m.set(0, 10);
    m.set(1, 20);
    chart.appendFrame(0, m);

    expect(chart.lastValue(0)).toBe(10);
    expect(chart.lastValue(1)).toBe(20);
  });

  it('lança fora do modo ring', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00' }],
      autoDraw: false,
    } as any);

    expect(() => chart.appendFrame(0, { a: 10 } as any)).toThrow('requires ring mode');
  });

  it('destroyed não dispara appendFrame', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.destroy();

    // Não deve lançar nem alterar nada.
    expect(() => chart.appendFrame(0, { a: 10 })).not.toThrow();
    expect(chart.pointCount('a')).toBe(0);
  });
});

describe('Events (v1.5.0)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  it('on("frameappended") recebe payload', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    const events: { seriesUpdated: number; render: boolean }[] = [];
    chart.on('frameappended', (ev) => events.push(ev));

    chart.appendFrame(0, { a: 10, b: 20 });

    expect(events).toHaveLength(1);
    expect(events[0].seriesUpdated).toBe(2); // 2 updated
    expect(events[0].render).toBe(false); // autoDraw off
  });

  it('frameappended inclui carry-forward no seriesUpdated', () => {
    const chart = new LineChart(canvas, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
      ],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.appendFrame(0, { a: 10, b: 20 }); // seed

    const events: { seriesUpdated: number }[] = [];
    chart.on('frameappended', (ev) => events.push(ev));

    // 'b' ausente → carry-forward conta como atualizada.
    chart.appendFrame(1, { a: 11 });

    expect(events).toHaveLength(1);
    expect(events[0].seriesUpdated).toBe(2); // 'a' updated + 'b' carried
  });

  it('off remove listener', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    const calls: number[] = [];
    const fn = () => calls.push(1);
    chart.on('frameappended', fn);
    chart.off('frameappended', fn);

    chart.appendFrame(0, { a: 10 });

    expect(calls).toHaveLength(0);
  });

  it('off com listener inexistente é no-op', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    expect(() => chart.off('frameappended', () => {})).not.toThrow();
  });

  it('destroy emite evento uma vez', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    const calls: number[] = [];
    chart.on('destroy', () => calls.push(1));

    chart.destroy();
    expect(calls).toHaveLength(1);

    // Idempotente: destroy de novo não emite.
    chart.destroy();
    expect(calls).toHaveLength(1);
  });

  it('após destroy, listeners são limpos e appendFrame não emite', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    let frameCalls = 0;
    chart.on('frameappended', () => frameCalls++);
    let destroyCalls = 0;
    chart.on('destroy', () => destroyCalls++);

    chart.destroy();

    expect(destroyCalls).toBe(1);
    // Após destroy, appendFrame não deve emitir nem lançar.
    expect(() => chart.appendFrame(0, { a: 10 })).not.toThrow();
    expect(frameCalls).toBe(0);
  });

  it('on/off em chart destruído é no-op', () => {
    const chart = new LineChart(canvas, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 100,
      autoDraw: false,
    } as any);

    chart.destroy();

    const fn = () => {};
    expect(() => chart.on('frameappended', fn)).not.toThrow();
    expect(() => chart.off('frameappended', fn)).not.toThrow();
  });
});

describe('v1.6.0 — eixo temporal, formatadores e gapMode', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
  });

  afterEach(() => {
    canvas.remove();
  });

  it('xAxis.type "time" inválido gera aviso e cai para "linear"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chart = new LineChart(canvas, { xAxis: { type: 'bogus' as any }, autoDraw: false } as any);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('xAxis.type "bogus" is invalid'));
    expect(chart['opts'].xAxis.type).toBe('linear');
    warn.mockRestore();
  });

  it('gapMode inválido no chart gera aviso e cai para "break"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chart = new LineChart(canvas, { gapMode: 'bogus' as any, autoDraw: false } as any);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gapMode "bogus" is invalid'));
    expect(chart['opts'].gapMode).toBe('break');
    warn.mockRestore();
  });

  it('gapMode inválido em uma série gera aviso e é ignorado (usa o padrão do chart)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00', gapMode: 'bogus' as any }],
      autoDraw: false,
    } as any);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('series[0] has invalid gapMode "bogus"'));
    expect(chart['seriesConfigs'][0].gapMode).toBeUndefined();
    warn.mockRestore();
  });

  it('gapMode padrão do ChartOpts é "break"', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    expect(chart['opts'].gapMode).toBe('break');
  });

  it('SeriesConfig.gapMode sobrescreve o gapMode do chart ao renderizar', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00', gapMode: 'connect' }],
      gapMode: 'break',
      autoDraw: false,
    } as any);
    const x = new Float64Array([0, 1, 2]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, NaN, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    // draw() não deve lançar com o gapMode de série resolvido corretamente.
    expect(() => chart.draw()).not.toThrow();
  });

  it('xAxis/yAxis/tooltip têm defaults resolvidos mesmo sem opts explícitos', () => {
    const chart = new LineChart(canvas, { autoDraw: false } as any);
    expect(chart['opts'].xAxis).toEqual({ type: 'linear' });
    expect(chart['opts'].yAxis).toEqual({});
    expect(chart['opts'].tooltip).toEqual({});
  });

  it('draw() com xAxis.type "time" e dados epoch-ms não lança', () => {
    const chart = new LineChart(canvas, { xAxis: { type: 'time' }, autoDraw: false } as any);
    const base = Date.UTC(2026, 0, 1);
    const x = new Float64Array([base, base + 60_000, base + 120_000]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    expect(() => chart.draw()).not.toThrow();
  });

  it('NaN em série com gapMode "break" não quebra o ciclo setData → draw', () => {
    const chart = new LineChart(canvas, {
      series: [{ name: 'A', color: '#f00', gapMode: 'break' }],
      autoDraw: false,
    } as any);
    const x = new Float64Array([0, 1, 2, 3, 4]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([10, NaN, NaN, 20, 30]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    expect(() => chart.draw()).not.toThrow();
    expect(chart.pointCount(0)).toBe(5);
  });
});

describe('v1.7.0 — viewport, zoom, pan e Pointer Events', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
    vi.useFakeTimers();
  });

  afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
  });

  function seedChart(opts?: Record<string, unknown>): LineChart {
    const chart = new LineChart(canvas, { autoDraw: false, ...opts } as any);
    const x = new Float64Array([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();
    return chart;
  }

  function pointer(
    type: string,
    opts: { clientX: number; clientY: number; pointerId?: number; pointerType?: string; button?: number },
  ): PointerEvent {
    return new PointerEvent(type, {
      clientX: opts.clientX,
      clientY: opts.clientY,
      pointerId: opts.pointerId ?? 1,
      pointerType: opts.pointerType ?? 'mouse',
      button: opts.button ?? 0,
      bubbles: true,
      cancelable: true,
    });
  }

  // happy-dom's WheelEvent constructor doesn't forward clientX/clientY (real
  // browsers do — WheelEvent extends MouseEvent). Define them explicitly so
  // the test environment matches production behaviour.
  function wheel(opts: { clientX: number; clientY: number; deltaY: number }): WheelEvent {
    const evt = new WheelEvent('wheel', { deltaY: opts.deltaY, bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clientX', { value: opts.clientX, configurable: true });
    Object.defineProperty(evt, 'clientY', { value: opts.clientY, configurable: true });
    return evt;
  }

  it('getViewport retorna null antes de qualquer setViewport', () => {
    const chart = seedChart();
    expect(chart.getViewport()).toBeNull();
  });

  it('setViewport define o domínio X e getViewport reflete o valor', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: 10, xMax: 50 });
    expect(chart.getViewport()).toEqual({ xMin: 10, xMax: 50 });
    chart.draw();
    expect(chart['gridDomainLeft'].xMin).toBe(10);
    expect(chart['gridDomainLeft'].xMax).toBe(50);
  });

  it('setViewport com xMin >= xMax lança erro', () => {
    const chart = seedChart();
    expect(() => chart.setViewport({ xMin: 50, xMax: 10 })).toThrow();
    expect(() => chart.setViewport({ xMin: 10, xMax: 10 })).toThrow();
  });

  it('setViewport com valores não finitos lança erro', () => {
    const chart = seedChart();
    expect(() => chart.setViewport({ xMin: NaN, xMax: 50 })).toThrow();
    expect(() => chart.setViewport({ xMin: 0, xMax: Infinity })).toThrow();
  });

  it('setViewport é clampado à extensão de dados visível', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: -50, xMax: 150 });
    // A janela pedida cobre toda a extensão (0..100) → equivale a reset (null).
    expect(chart.getViewport()).toBeNull();
  });

  it('setViewport clampa parcialmente quando a janela ultrapassa só um lado', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: -20, xMax: 30 });
    const vp = chart.getViewport();
    expect(vp).not.toBeNull();
    expect(vp!.xMin).toBe(0);
    expect(vp!.xMax).toBeLessThanOrEqual(50);
  });

  it('resetViewport restaura o domínio completo', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: 10, xMax: 50 });
    chart.resetViewport();
    expect(chart.getViewport()).toBeNull();
    chart.draw();
    expect(chart['gridDomainLeft'].xMin).toBe(0);
    expect(chart['gridDomainLeft'].xMax).toBe(100);
  });

  it('resetViewport sem viewport ativo é no-op (não emite evento)', () => {
    const chart = seedChart();
    const calls: unknown[] = [];
    chart.on('viewportchange', (ev) => calls.push(ev));
    chart.resetViewport();
    expect(calls).toHaveLength(0);
  });

  it('setViewport emite "viewportchange" com o payload aplicado', () => {
    const chart = seedChart();
    const calls: { xMin: number; xMax: number }[] = [];
    chart.on('viewportchange', (ev) => calls.push(ev));
    chart.setViewport({ xMin: 10, xMax: 50 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ xMin: 10, xMax: 50 });
  });

  it('resetViewport emite "viewportchange" com o domínio completo', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: 10, xMax: 50 });
    const calls: { xMin: number; xMax: number }[] = [];
    chart.on('viewportchange', (ev) => calls.push(ev));
    chart.resetViewport();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ xMin: 0, xMax: 100 });
  });

  it('decimação/render usam apenas o viewport visível (grid segue o viewport, não a extensão total)', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: 20, xMax: 40 });
    chart.draw();
    expect(chart['gridDomainLeft'].xMin).toBe(20);
    expect(chart['gridDomainLeft'].xMax).toBe(40);
  });

  it('zoom por roda (wheel) mantém o ponto sob o cursor e reduz a janela', () => {
    const chart = seedChart();
    const plot = chart['plotRect']();
    const pxX = plot.x + plot.w / 2; // centro do plot
    // Domínio antes do zoom é a extensão completa (0..100) — o dado sob o
    // cursor (centro do plot) corresponde ao valor de x no meio do domínio.
    const anchorBefore = 0 + ((pxX - plot.x) / plot.w) * (100 - 0);

    canvas.dispatchEvent(wheel({ deltaY: -100, clientX: pxX, clientY: plot.y + 1 }));

    const vp = chart.getViewport();
    expect(vp).not.toBeNull();
    expect(vp!.xMax - vp!.xMin).toBeLessThan(100); // janela encolheu (zoom in)

    // O ponto de dados sob o cursor permanece aproximadamente no mesmo pixel.
    const plotAfter = chart['plotRect']();
    const pxAfter = plotAfter.x + ((anchorBefore - vp!.xMin) / (vp!.xMax - vp!.xMin)) * plotAfter.w;
    expect(pxAfter).toBeCloseTo(pxX, 0);
  });

  it('zoom-out além da extensão total limpa o viewport (equivale a reset)', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: 40, xMax: 60 });
    const plot = chart['plotRect']();
    const pxX = plot.x + plot.w / 2;
    // deltaY positivo = zoom out; fator grande o suficiente para estourar a extensão total.
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(wheel({ deltaY: 100, clientX: pxX, clientY: plot.y + 1 }));
    }
    expect(chart.getViewport()).toBeNull();
  });

  it('wheel funciona com eixo temporal (xAxis.type: "time")', () => {
    const chart = new LineChart(canvas, { autoDraw: false, xAxis: { type: 'time' } } as any);
    const base = 1_700_000_000_000;
    const x = new Float64Array(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => base + i * 60_000),
    ) as unknown as Float64Array<ArrayBufferLike>;
    const y = new Float64Array([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) as unknown as Float64Array<ArrayBufferLike>;
    chart.setData(0, x, y);
    chart.draw();

    const plot = chart['plotRect']();
    const pxX = plot.x + plot.w / 2;
    canvas.dispatchEvent(wheel({ deltaY: -100, clientX: pxX, clientY: plot.y + 1 }));

    const vp = chart.getViewport();
    expect(vp).not.toBeNull();
    expect(vp!.xMax - vp!.xMin).toBeLessThan(10 * 60_000);
  });

  it('pan por arraste (pointer drag) desloca a janela e respeita o domínio', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: 20, xMax: 40 });
    const plot = chart['plotRect']();
    const startPx = plot.x + plot.w / 2;

    canvas.dispatchEvent(pointer('pointerdown', { clientX: startPx, clientY: plot.y + 1 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: startPx - 20, clientY: plot.y + 1 }));
    canvas.dispatchEvent(pointer('pointerup', { clientX: startPx - 20, clientY: plot.y + 1 }));

    const vp = chart.getViewport();
    expect(vp).not.toBeNull();
    expect(vp!.xMax - vp!.xMin).toBeCloseTo(20, 5); // largura preservada
    expect(vp!.xMin).toBeGreaterThan(20); // arrastar para a esquerda revela dados à direita
  });

  it('pan não ultrapassa o domínio total (clamp preserva a largura da janela)', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: 0, xMax: 20 });
    const plot = chart['plotRect']();
    const startPx = plot.x + plot.w / 2;

    // Arrasta bem para a direita (revela dados à esquerda) além do limite.
    canvas.dispatchEvent(pointer('pointerdown', { clientX: startPx, clientY: plot.y + 1 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: startPx + 1000, clientY: plot.y + 1 }));
    canvas.dispatchEvent(pointer('pointerup', { clientX: startPx + 1000, clientY: plot.y + 1 }));

    const vp = chart.getViewport();
    expect(vp).not.toBeNull();
    expect(vp!.xMin).toBe(0);
    expect(vp!.xMax).toBeCloseTo(20, 5); // largura preservada no limite
  });

  it('pointermove sem arraste move o crosshair (mouse)', () => {
    const chart = seedChart();
    const plot = chart['plotRect']();
    canvas.dispatchEvent(pointer('pointermove', { clientX: plot.x + plot.w / 2, clientY: plot.y + plot.h / 2 }));
    expect(chart['showCrosshair']).toBe(true);
  });

  it('pointermove com pointerType touch move o crosshair', () => {
    const chart = seedChart();
    const plot = chart['plotRect']();
    canvas.dispatchEvent(
      pointer('pointermove', { clientX: plot.x + plot.w / 2, clientY: plot.y + plot.h / 2, pointerType: 'touch' }),
    );
    expect(chart['showCrosshair']).toBe(true);
  });

  it('pointerleave fora de um arraste esconde o crosshair', () => {
    const chart = seedChart();
    const plot = chart['plotRect']();
    canvas.dispatchEvent(pointer('pointermove', { clientX: plot.x + plot.w / 2, clientY: plot.y + plot.h / 2 }));
    expect(chart['showCrosshair']).toBe(true);
    canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(chart['showCrosshair']).toBe(false);
  });

  it('pointerleave durante um arraste não esconde o crosshair', () => {
    const chart = seedChart();
    chart.setViewport({ xMin: 20, xMax: 40 });
    const plot = chart['plotRect']();
    const startPx = plot.x + plot.w / 2;

    canvas.dispatchEvent(pointer('pointerdown', { clientX: startPx, clientY: plot.y + 1 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: startPx - 10, clientY: plot.y + 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(chart['showCrosshair']).toBe(true);
    expect(chart['dragging']).toBe(true);
  });

  it('wheel não é ignorado (preventDefault chamado para não rolar a página)', () => {
    const chart = seedChart();
    const plot = chart['plotRect']();
    const evt = wheel({ deltaY: -100, clientX: plot.x + plot.w / 2, clientY: plot.y + 1 });
    const spy = vi.spyOn(evt, 'preventDefault');
    canvas.dispatchEvent(evt);
    expect(spy).toHaveBeenCalled();
  });

  it('touch-action da canvas é "none" para permitir pan/zoom customizados', () => {
    seedChart();
    expect(canvas.style.touchAction).toBe('none');
  });

  it('pointerdown fora do plot não inicia arraste', () => {
    const chart = seedChart();
    canvas.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 }));
    expect(chart['dragging']).toBe(false);
  });

  it('destroy remove os listeners de pointer/wheel sem lançar', () => {
    const chart = seedChart();
    expect(() => chart.destroy()).not.toThrow();
    const plot = { x: 56, y: 16, w: 328, h: 152 };
    expect(() =>
      canvas.dispatchEvent(pointer('pointermove', { clientX: plot.x + plot.w / 2, clientY: plot.y + plot.h / 2 })),
    ).not.toThrow();
  });

  it('pinch (dois dedos afastando) aplica zoom no centroide', () => {
    const chart = seedChart();
    const plot = chart['plotRect']();
    const midY = plot.y + plot.h / 2;
    const centre = plot.x + plot.w / 2;

    // Two fingers land straddling the centroid.
    canvas.dispatchEvent(
      pointer('pointerdown', { clientX: centre - 20, clientY: midY, pointerId: 10, pointerType: 'touch' }),
    );
    canvas.dispatchEvent(
      pointer('pointerdown', { clientX: centre + 20, clientY: midY, pointerId: 11, pointerType: 'touch' }),
    );
    expect(chart['pinching']).toBe(true);

    // First pinch move seeds the baseline (no viewport change yet).
    canvas.dispatchEvent(
      pointer('pointermove', { clientX: centre - 20, clientY: midY, pointerId: 10, pointerType: 'touch' }),
    );
    expect(chart.getViewport()).toBeNull();

    // Spread the fingers apart → zoom in (viewport window shrinks).
    canvas.dispatchEvent(
      pointer('pointermove', { clientX: centre - 100, clientY: midY, pointerId: 10, pointerType: 'touch' }),
    );
    canvas.dispatchEvent(
      pointer('pointermove', { clientX: centre + 100, clientY: midY, pointerId: 11, pointerType: 'touch' }),
    );
    const vp = chart.getViewport();
    expect(vp).not.toBeNull();
    expect(vp!.xMax - vp!.xMin).toBeLessThan(100);
  });

  it('lift de um dedo durante pinch faz handoff para pan de um dedo', () => {
    const chart = seedChart();
    const plot = chart['plotRect']();
    const midY = plot.y + plot.h / 2;
    const centre = plot.x + plot.w / 2;

    canvas.dispatchEvent(
      pointer('pointerdown', { clientX: centre - 20, clientY: midY, pointerId: 10, pointerType: 'touch' }),
    );
    canvas.dispatchEvent(
      pointer('pointerdown', { clientX: centre + 20, clientY: midY, pointerId: 11, pointerType: 'touch' }),
    );
    expect(chart['pinching']).toBe(true);

    // Lift finger 11 → pinch ends, finger 10 becomes the pan anchor.
    canvas.dispatchEvent(
      pointer('pointerup', { clientX: centre + 20, clientY: midY, pointerId: 11, pointerType: 'touch' }),
    );
    expect(chart['pinching']).toBe(false);
    expect(chart['dragging']).toBe(true);
  });
});
