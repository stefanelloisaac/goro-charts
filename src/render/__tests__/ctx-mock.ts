/**
 * Shared mock CanvasRenderingContext2D for render tests.
 * Records calls so tests can verify drawing commands were issued correctly.
 */

export interface MockCtxCalls {
  beginPath: number;
  stroke: number;
  fill: number;
  closePath: number;
  moveTo: Array<[number, number]>;
  lineTo: Array<[number, number]>;
  arc: Array<[number, number, number, number, number]>;
  strokeRect: Array<[number, number, number, number]>;
  fillText: Array<[string, number, number]>;
  measureText: Array<string>;
}

export interface MockCtxState {
  font: string;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  globalAlpha: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineDash: number[];
}

export function createMockCtx(): CanvasRenderingContext2D & { calls: MockCtxCalls; state: MockCtxState } {
  const calls: MockCtxCalls = {
    beginPath: 0,
    stroke: 0,
    fill: 0,
    closePath: 0,
    moveTo: [],
    lineTo: [],
    arc: [],
    strokeRect: [],
    fillText: [],
    measureText: [],
  };

  const state: MockCtxState = {
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
    calls,
    state,

    canvas: {} as HTMLCanvasElement,

    get font() { return state.font; },
    set font(v: string) { state.font = v; },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v: string | CanvasGradient | CanvasPattern) { state.strokeStyle = String(v); },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) { state.fillStyle = String(v); },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v: number) { state.lineWidth = v; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v: number) { state.globalAlpha = v; },
    get textAlign() { return state.textAlign; },
    set textAlign(v: CanvasTextAlign) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; },
    set textBaseline(v: CanvasTextBaseline) { state.textBaseline = v; },

    beginPath() { calls.beginPath++; },
    stroke() { calls.stroke++; },
    fill() { calls.fill++; },
    closePath() { calls.closePath++; },
    moveTo(x: number, y: number) { calls.moveTo.push([x, y]); },
    lineTo(x: number, y: number) { calls.lineTo.push([x, y]); },
    arc(x: number, y: number, r: number, sa: number, ea: number) { calls.arc.push([x, y, r, sa, ea]); },
    strokeRect(x: number, y: number, w: number, h: number) { calls.strokeRect.push([x, y, w, h]); },
    fillText(text: string, x: number, y: number) { calls.fillText.push([text, x, y]); },
    setLineDash(segments: number[]) { state.lineDash = segments; },
    getLineDash() { return state.lineDash; },
    measureText(text: string) {
      calls.measureText.push(text);
      return { width: text.length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 2 } as TextMetrics;
    },
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    clearRect() {},
    fillRect() {},
    rect() {},
    arcTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    createLinearGradient() { return { addColorStop() {} } as unknown as CanvasGradient; },
    createRadialGradient() { return { addColorStop() {} } as unknown as CanvasGradient; },
    createPattern() { return null; },
    drawImage() {},
    clip() {},
    isPointInPath() { return false; },
    isPointInStroke() { return false; },
    putImageData() {},
    getImageData() { return { data: new Uint8ClampedArray(0), width: 0, height: 0 } as ImageData; },
    createImageData() { return { data: new Uint8ClampedArray(0), width: 0, height: 0 } as ImageData; },
    setTransform() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as DOMMatrix; },
    transform() {},
    resetTransform() {},
    drawFocusIfNeeded() {},
    scrollPathIntoView() {},
  } as unknown as CanvasRenderingContext2D & { calls: MockCtxCalls; state: MockCtxState };

  return ctx;
}
