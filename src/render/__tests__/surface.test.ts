import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Surface } from '../surface';

/**
 * Surface tests require a real canvas element (happy-dom provides this).
 */

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.width = '400px';
  canvas.style.height = '200px';
  // happy-dom não faz layout CSS, então mockamos o bounding rect
  canvas.getBoundingClientRect = () =>
    ({ width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, x: 0, y: 0 }) as DOMRect;
  document.body.appendChild(canvas);
  return canvas;
}

describe('Surface', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createCanvas();
  });

  afterEach(() => {
    canvas.remove();
  });

  it('construtor configura canvas e DPR', () => {
    const s = new Surface(canvas);
    expect(s.canvas).toBe(canvas);
    expect(s.dpr).toBeGreaterThanOrEqual(1);
  });

  it('measure detecta tamanho do CSS', () => {
    const s = new Surface(canvas);
    expect(s.cssW).toBe(400);
    expect(s.cssH).toBe(200);
  });

  it('measure retorna false se tamanho não mudou', () => {
    const s = new Surface(canvas);
    const result = s.measure();
    // Na segunda chamada, o tamanho não mudou
    expect(result).toBe(false);
  });

  it('offscreenCtx cria contexto', () => {
    const s = new Surface(canvas);
    const ctx = s.offscreenCtx();
    expect(ctx).toBeTruthy();
  });

  it('blit não lança erro', () => {
    const s = new Surface(canvas);
    // Força criação do offscreen
    s.offscreenCtx();
    expect(() => s.blit()).not.toThrow();
  });

  it('dispose limpa referências', () => {
    const s = new Surface(canvas);
    s.offscreenCtx();
    s.dispose();
    // Chamar blit após dispose não deve lançar
    expect(() => s.blit()).not.toThrow();
  });
});
