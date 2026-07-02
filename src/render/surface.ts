/**
 * @file Canvas surface: DPR handling, sizing, and the offscreen blit buffer.
 *
 * Owns the visible canvas plus an offscreen canvas that holds the static
 * content (grid, axes, and the series). Both contexts carry a devicePixelRatio transform
 * so all drawing happens in CSS-pixel coordinates. The static layer is painted
 * once to the offscreen buffer; `blit` copies it to the visible canvas 1:1 in
 * device pixels, leaving the crosshair to be overlaid on top — so cursor
 * movement never repaints the series.
 */

/** Manages the visible canvas, its DPR transform, and the offscreen buffer. */
export class Surface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly dpr: number;

  cssW = 0;
  cssH = 0;

  private offCanvas: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Accessibility
    canvas.setAttribute('role', 'img');
    canvas.tabIndex = 0;

    this.dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.measure();
  }

  /**
   * Re-measure the canvas against its CSS box and resize the backing store.
   * @returns true if the size actually changed (caller should redraw)
   */
  measure(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    // Ignore zero/negative sizes (display:none, detached, pre-layout).
    if (w <= 0 || h <= 0) return false;

    // Skip redundant ResizeObserver fires where nothing changed.
    const bw = w * this.dpr;
    const bh = h * this.dpr;
    if (this.cssW === w && this.cssH === h && this.canvas.width === bw) return false;

    this.cssW = w;
    this.cssH = h;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.offCanvas = null;
    this.offCtx = null;
    return true;
  }

  /** Get the offscreen context (lazily created), ready in CSS-pixel coords. */
  offscreenCtx(): CanvasRenderingContext2D {
    const bw = this.canvas.width;
    const bh = this.canvas.height;
    if (this.offCanvas && this.offCanvas.width === bw && this.offCanvas.height === bh) {
      return this.offCtx!;
    }
    const off = document.createElement('canvas');
    off.width = bw;
    off.height = bh;
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('Offscreen 2D context not available');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.offCanvas = off;
    this.offCtx = ctx;
    return ctx;
  }

  /** Copy the offscreen buffer onto the visible canvas, 1:1 in device pixels. */
  blit(): void {
    if (!this.offCanvas) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.offCanvas, 0, 0);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Release the offscreen buffer references. */
  dispose(): void {
    this.offCanvas = null;
    this.offCtx = null;
  }
}
