/**
 * Global vitest setup: mock canvas getContext for happy-dom.
 * happy-dom does not implement HTMLCanvasElement.getContext('2d'),
 * so we provide a minimal mock that returns a dummy context.
 */

import { vi } from 'vitest';

interface SetupState {
  font: string;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  globalAlpha: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineDash: number[];
}

// Mock getContext to return a minimal CanvasRenderingContext2D stub
(HTMLCanvasElement.prototype as any).getContext = function (contextId: string) {
  if (contextId === '2d') {
    const state: SetupState = {
      font: '11px system-ui, sans-serif',
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      globalAlpha: 1,
      textAlign: 'start' as CanvasTextAlign,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      lineDash: [],
    };

    const ctx = {
      canvas: this,

      get font() { return state.font; },
      set font(v: string) { state.font = v; },
      get strokeStyle() { return state.strokeStyle; },
      set strokeStyle(v: any) { state.strokeStyle = String(v); },
      get fillStyle() { return state.fillStyle; },
      set fillStyle(v: any) { state.fillStyle = String(v); },
      get lineWidth() { return state.lineWidth; },
      set lineWidth(v: number) { state.lineWidth = v; },
      get globalAlpha() { return state.globalAlpha; },
      set globalAlpha(v: number) { state.globalAlpha = v; },
      get textAlign() { return state.textAlign; },
      set textAlign(v: CanvasTextAlign) { state.textAlign = v; },
      get textBaseline() { return state.textBaseline; },
      set textBaseline(v: CanvasTextBaseline) { state.textBaseline = v; },

      beginPath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 28, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 2 })),
      setLineDash: vi.fn(function (this: any, segments: number[]) { state.lineDash = segments; }),
      getLineDash: vi.fn(function () { return state.lineDash; }),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      rect: vi.fn(),
      arcTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createPattern: vi.fn(() => null),
      drawImage: vi.fn(),
      clip: vi.fn(),
      isPointInPath: vi.fn(() => false),
      isPointInStroke: vi.fn(() => false),
      putImageData: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 })),
      createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 })),
      setTransform: vi.fn(),
      getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
      transform: vi.fn(),
      resetTransform: vi.fn(),
      drawFocusIfNeeded: vi.fn(),
      scrollPathIntoView: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    // Stub toDataURL
    (this as any).toDataURL = vi.fn(() => 'data:image/png;base64,iVBORw0KGgo=');

    return ctx;
  }

  // Fallback for other context types (webgl, etc.)
  return null;
};
