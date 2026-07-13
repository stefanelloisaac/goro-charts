/**
 * @file Canvas surface: DPR-aware sizing, two-layer offscreen compositing.
 *
 * Owns the visible canvas plus TWO offscreen canvases:
 *
 * 1. **Frame layer** (`frameCanvas`/`frameCtx`) — background, grid, axes,
 *    labels, legend. Redrawn only when the domain or visual options change.
 * 2. **Series layer** (`seriesCanvas`/`seriesCtx`) — clipped series paths
 *    (lines, areas, scatter, stacked bands). Redrawn on every data mutation.
 *
 * The series layer is **conditional**: it is only allocated when the chart
 * enters ring/streaming mode (`maxPoints > 0`). Static charts keep the
 * single-offscreen path (frame layer only).
 *
 * `blit()` composes: clear visible → `drawImage(frameCanvas)` →
 * `drawImage(seriesCanvas)` → (optional crosshair overlay done by caller).
 *
 * All contexts carry a `devicePixelRatio` transform so drawing code works in
 * CSS-pixel coordinates throughout.
 */

/** Manages the visible canvas, its DPR transform, and the offscreen buffers. */
export class Surface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly dpr: number;

  cssW = 0;
  cssH = 0;

  /** The frame layer (grid, axes, labels, legend). Always present after first paint. */
  private frameCanvas: HTMLCanvasElement | null = null;
  private frameCtx: CanvasRenderingContext2D | null = null;

  /** The series layer (lines, areas, scatter, stacked bands). Conditional — see {@link seriesLayerEnabled}. */
  private seriesCanvas: HTMLCanvasElement | null = null;
  private seriesCtx: CanvasRenderingContext2D | null = null;

  /** True once the series layer has been allocated (ring/streaming mode). */
  private _seriesLayerEnabled = false;

  /** Whether the series offscreen has been allocated. */
  get seriesLayerEnabled(): boolean {
    return this._seriesLayerEnabled;
  }

  /**
   * Cached canvas position (left/top in viewport CSS pixels). Interaction
   * handlers call {@link clientRect} on every pointer/wheel event; without
   * this cache every event pays a `getBoundingClientRect()`, which forces
   * layout when combined with any style read since the last frame. Cache is
   * invalidated on resize (via {@link measure}) and on scroll/zoom (via
   * {@link invalidateClientRect}, wired from ChartBase).
   */
  private cachedRect: { left: number; top: number } | null = null;

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
   * Allocate the series offscreen layer. Call once when the chart enters
   * ring/streaming mode (maxPoints > 0 at construction or on first
   * setMaxPoints(n>0)). Idempotent.
   *
   * The series layer is **never** deallocated once active (the cost of
   * reallocation on intermittent streaming outweighs the memory saved).
   */
  enableSeriesLayer(): void {
    if (this._seriesLayerEnabled) return;
    this._seriesLayerEnabled = true;
    // Lazily allocated on first seriesContext() call (current dimensions
    // already known).
  }

  /**
   * Re-measure the canvas against its CSS box and resize backing stores.
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

    // Drop both offscreen buffers — they will be recreated on next access
    // with the correct dimensions.
    this.frameCanvas = null;
    this.frameCtx = null;
    this.seriesCanvas = null;
    this.seriesCtx = null;
    this.cachedRect = null;
    return true;
  }

  /**
   * Canvas `{ left, top }` in viewport CSS pixels — a cached alternative to
   * `canvas.getBoundingClientRect()` for hot input paths. The cache is
   * invalidated on {@link measure} and by {@link invalidateClientRect}
   * (called by ChartBase on window scroll / visualViewport changes).
   */
  clientRect(): { left: number; top: number } {
    if (this.cachedRect) return this.cachedRect;
    const r = this.canvas.getBoundingClientRect();
    this.cachedRect = { left: r.left, top: r.top };
    return this.cachedRect;
  }

  /** Drop the cached rect (call after scroll or ancestor layout change). */
  invalidateClientRect(): void {
    this.cachedRect = null;
  }

  /**
   * Get the FRAME offscreen context (lazily created), ready in CSS-pixel
   * coords. This is the "frame layer" — background, grid, axes, labels,
   * legend. Always present after first access.
   *
   * NOTE: this replaces the pre-v1.9.0 `offscreenCtx()` which served both
   * frame + series in a single buffer. The old method name is kept as an
   * alias for migration (see {@link frameContext}).
   */
  frameContext(): CanvasRenderingContext2D {
    return this.ensureLayer('frame');
  }

  /**
   * Get the SERIES offscreen context (lazily created), or `null` if the
   * series layer has not been enabled (static chart mode). Callers must
   * handle the `null` case gracefully.
   */
  seriesContext(): CanvasRenderingContext2D | null {
    if (!this._seriesLayerEnabled) return null;
    return this.ensureLayer('series');
  }

  /**
   * @deprecated Use {@link frameContext} or {@link seriesContext}.
   *   Pre-v1.9.0 alias for the single offscreen context — now returns the
   *   frame layer for backward compatibility during migration.
   */
  offscreenCtx(): CanvasRenderingContext2D {
    return this.frameContext();
  }

  /**
   * Lazily allocate (or re-use) one of the two offscreen canvases.
   * Both contexts carry the DPR transform so all drawing happens in
   * CSS-pixel coordinates.
   */
  private ensureLayer(which: 'frame' | 'series'): CanvasRenderingContext2D {
    const bw = this.canvas.width;
    const bh = this.canvas.height;

    if (which === 'frame') {
      if (this.frameCanvas && this.frameCanvas.width === bw && this.frameCanvas.height === bh) {
        return this.frameCtx!;
      }
      const off = document.createElement('canvas');
      off.width = bw;
      off.height = bh;
      const ctx = off.getContext('2d');
      if (!ctx) throw new Error('Offscreen 2D context not available');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.frameCanvas = off;
      this.frameCtx = ctx;
      return ctx;
    }

    // Series layer
    if (this.seriesCanvas && this.seriesCanvas.width === bw && this.seriesCanvas.height === bh) {
      return this.seriesCtx!;
    }
    const off = document.createElement('canvas');
    off.width = bw;
    off.height = bh;
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('Offscreen 2D context not available');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.seriesCanvas = off;
    this.seriesCtx = ctx;
    return ctx;
  }

  /**
   * Copy the offscreen buffers onto the visible canvas, in device-pixel
   * order: frame layer first, then series layer on top. The caller
   * (ChartBase) is responsible for overlaying the crosshair after this.
   *
   * When the series layer is disabled (static chart), this is equivalent to
   * the pre-v1.9.0 single-buffer blit.
   */
  blit(): void {
    if (!this.frameCanvas) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.frameCanvas, 0, 0);
    if (this._seriesLayerEnabled && this.seriesCanvas) {
      this.ctx.drawImage(this.seriesCanvas, 0, 0);
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Release offscreen buffer references for both layers. */
  dispose(): void {
    this.frameCanvas = null;
    this.frameCtx = null;
    this.seriesCanvas = null;
    this.seriesCtx = null;
  }
}
