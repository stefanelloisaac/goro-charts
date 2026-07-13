/**
 * @file Abstract chart orchestrator shared by every chart type.
 *
 * Owns cross-cutting concerns: the data stores (one per series), the canvas
 * surface, the dirty flag and rAF coalescing, pointer interaction state, the
 * ResizeObserver, and the draw sequence (static layer → offscreen, blit,
 * crosshair overlay). All data lives in {@link SeriesStore} instances; all
 * pixels are produced by the `render/` functions.
 *
 * Multi-series: a {@link SeriesStore} is created for each
 * {@link SeriesConfig} entry. The series extent is computed as a union over
 * all stores so grid ticks span every visible series. Each store is rendered
 * independently by the subclass's {@link renderSeries}, receiving per-series
 * colour/style overrides merged from its config entry.
 *
 * Dual-Y: when any series opts into `yAxis: 'right'` the chart maintains
 * left and right grid domains independently. Left-axis series share the left
 * domain; right-axis series share the right. Tick labels appear on both sides
 * and the crosshair reads the correct axis per series.
 */

import { CHART_DEFAULTS } from '../defaults.ts';
import { SeriesStore } from '../data/series-store.ts';
import { Surface } from '../render/surface.ts';
import { renderGrid, renderAxes } from '../render/axes.ts';
import { renderCrosshair, computeHits } from '../render/crosshair.ts';
import { renderLegend } from '../render/legend.ts';
import { renderStackedBands } from '../render/stacked-band.ts';
import { TickCache } from '../math/tick-cache.ts';
import { formatNumber } from '../math/format.ts';
import { pxToX, xToPx } from '../math/scale.ts';
import type {
  ChartOpts,
  ChartOptionsPatch,
  ResolvedOpts,
  SeriesConfig,
  SeriesRef,
  SeriesView,
  PlotRect,
  Domain,
  DataOwnership,
  ChartEventMap,
  ChartEventType,
  ChartEventListener,
  ChartFrameValues,
  Viewport,
} from '../types.ts';
import type { SeriesHit } from '../render/crosshair.ts';

/**
 * Reusable {@link SeriesView} instance for the render/crosshair hot path.
 * Fields are plain data (`xMin`/`xMax`/`yMin`/`yMax`/`xArr`/`yArr`/`head`/
 * `count`/`cap`); `physOf` and `bracketLogical` delegate to the bound store
 * so ring wraparound still works. Calling {@link bind} rewrites the fields
 * in place and returns `this`, so a `ChartBase` can reuse the same instance
 * across frames instead of allocating a new proxy per series per frame.
 *
 * See the doc block on {@link ChartBase.viewSlotRender} for the pool
 * layout and why two pools (one for render, one for crosshair) are needed.
 */
class PooledView implements SeriesView {
  xArr!: Float64Array<ArrayBufferLike>;
  yArr!: Float64Array<ArrayBufferLike>;
  head = 0;
  count = 0;
  cap = 0;
  xMin = 0;
  xMax = 0;
  yMin = 0;
  yMax = 0;
  private store!: SeriesView;

  bind(
    store: SeriesView,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    yArrOverride?: Float64Array<ArrayBufferLike>,
  ): this {
    this.store = store;
    this.xArr = store.xArr;
    this.yArr = yArrOverride ?? store.yArr;
    this.head = store.head;
    this.count = store.count;
    this.cap = store.cap;
    this.xMin = xMin;
    this.xMax = xMax;
    this.yMin = yMin;
    this.yMax = yMax;
    return this;
  }

  physOf(logical: number): number {
    return this.store.physOf(logical);
  }

  bracketLogical(target: number): number {
    return this.store.bracketLogical(target);
  }
}

/** Abstract base for all chart types. */
export abstract class ChartBase {
  protected opts: ResolvedOpts;
  protected surface: Surface;
  protected stores: SeriesStore[];
  protected seriesConfigs: SeriesConfig[];

  /** Resolves a series `id` to its current index. Rebuilt on any structural mutation. */
  private seriesIndexById = new Map<string, number>();

  private gridDomainLeft: Domain = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  private gridDomainRight: Domain = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  private gridPinned = false;
  private hasRightAxis = false;

  /** v1.9.0: cache of ticks/labels keyed by tick VALUE SET + format identity. */
  private tickCache = new TickCache();

  /**
   * User-controlled X viewport (v1.7.0). When set, it is the highest-priority
   * source of truth for the X domain — {@link updateGridDomain} short-circuits
   * on it before touching streaming / `fixedY` / `gridPinned` logic. `null`
   * means "no viewport" (auto/streaming domain as before).
   */
  private viewport: Viewport | null = null;

  /**
   * Cached stack-group detection. `seriesConfigs` is immutable after the
   * constructor (validateOpts is the last writer), so groups are computed
   * once and reused every draw instead of rebuilt each frame.
   */
  private stackGroupsAll!: { groups: Map<string, number[]>; stacked: Set<number> };
  private stackGroupsByAxis!: Record<'left' | 'right', { groups: Map<string, number[]>; stacked: Set<number> }>;

  /**
   * Tracks stack-misalignment warnings already emitted, so a misaligned group
   * warns once instead of on every frame (accumulateStackGroup runs per draw).
   */
  private stackWarned = new Set<string>();

  /** Data / domain changed — recompute grid domain. */
  private dirtyDomain = false;
  /** Frame layer (grid, axes, labels, legend) — redraw in frame buffer. */
  private dirtyFrame = false;
  /** Series layer (lines, areas, scatter, stacked bands) — redraw in series buffer. */
  private dirtySeries = false;
  /**
   * Overlay (crosshair + hover callback + live region) — recompose on the
   * visible canvas. Set on pointer move, streaming ticks with active crosshair
   * (data slides under stationary cursor), and viewport gestures.
   */
  private dirtyOverlay = false;

  /** Typed event listeners registered via {@link on}. Cleared in {@link destroy}. */
  private listeners: Record<ChartEventType, Set<ChartEventListener<ChartEventType>>> = {
    frameappended: new Set(),
    destroy: new Set(),
    viewportchange: new Set(),
  };
  private cursorX = -1;
  private cursorY = -1;
  private showCrosshair = false;

  /** True while a pointer-drag pan gesture is active (set on pointerdown inside the plot). */
  private dragging = false;
  /** Pixel X of the pointer at the last pointermove during a drag, used to compute the pan delta. */
  private dragLastPx = -1;

  /**
   * v1.7.0: active pointers currently down inside the plot, keyed by
   * pointerId. Populated on pointerdown, removed on pointerup / cancel.
   * Used to detect the two-finger pinch gesture (touchpad or touchscreen)
   * — while exactly two pointers are down, pointermove computes zoom from
   * the distance between them and pan from their centroid.
   */
  private activePointers = new Map<number, { pxX: number; pxY: number }>();
  /**
   * Snapshot of the two-pointer state at the start of the pinch gesture
   * (or the last pointermove during the gesture): distance in CSS pixels
   * between the two pointers and centroid x. Reset when the gesture ends.
   */
  private pinchLastDist = 0;
  private pinchLastCentroidX = 0;
  private pinching = false;

  /**
   * Tracks whether the previous draw() painted a crosshair overlay. Lets draw()
   * re-blit (clean) the canvas when the crosshair is hidden outside a streaming
   * tick — without this the stale pixels stay until the next append.
   */
  private crosshairPainted = false;

  /** Logical index of the keyboard-cursor point in the reference series. */
  private cursorLogical = -1;

  private autoDraw: boolean;
  private rafScheduled = 0;
  private suspendCount = 0;
  private syncTargets = new Set<ChartBase>();

  /**
   * v1.7.0 interaction repaint coalescing. Wheel and pointermove handlers
   * fire multiple times per frame on modern input devices (120Hz+ touchpads
   * and free-spin mouse wheels can emit 5-10 events per display refresh).
   * State mutations (viewport, cursor) still happen synchronously in the
   * handlers so `getViewport()` and friends reflect the latest gesture
   * immediately, but the actual repaint is coalesced into a single rAF
   * callback via {@link scheduleInteractionFrame} so the render pipeline
   * runs at most once per frame.
   *
   * Separate from {@link rafScheduled}, which is only used when `autoDraw`
   * is true and reflects data mutations.
   */
  private interactionRafId = 0;

  private resizeObserver: ResizeObserver | null = null;
  protected destroyed = false;
  private liveRegion: HTMLElement | null = null;
  /**
   * Reference to the `prefers-reduced-motion` MQL plus its change listener.
   * Check `reducedMotionMql.matches` to test the preference; the listener
   * triggers a re-draw when the preference changes at runtime.
   */
  private reducedMotionMql: MediaQueryList | null = null;
  private readonly handleReducedMotionChange = () => {
    // The flag is live via reducedMotionMql.matches — just redraw.
    this.draw();
  };
  private readonly handleResize = () => this.onResize();
  private readonly handlePointerMove = (e: PointerEvent) => this.onPointerMove(e);
  private readonly handlePointerDown = (e: PointerEvent) => this.onPointerDown(e);
  private readonly handlePointerUp = (e: PointerEvent) => this.onPointerUp(e);
  private readonly handlePointerLeave = () => this.onPointerLeave();
  private readonly handleWheel = (e: WheelEvent) => this.onWheel(e);
  private readonly handleKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
  /**
   * Invalidate the surface's cached canvas position. Scrolling the page
   * moves the canvas in the viewport without triggering resize, and
   * pointer/wheel handlers rely on the cached rect to translate clientX/Y
   * to canvas-local pixels — a stale rect turns into a stuck cursor.
   */
  private readonly handleWindowLayoutShift = () => this.surface.invalidateClientRect();

  constructor(canvas: HTMLCanvasElement, opts?: ChartOpts) {
    this.opts = { ...CHART_DEFAULTS, ...opts };
    this.autoDraw = this.opts.autoDraw;

    this.seriesConfigs =
      this.opts.series.length > 0 ? this.opts.series : [{ name: 'Series 0', color: this.opts.lineColor }];

    this.validateOpts();

    this.surface = new Surface(canvas);

    this.stores = this.seriesConfigs.map(() => new SeriesStore());

    // Compute the id map, right-axis flag, and stack groups. Recomputed by
    // rebuildSeriesDerived() after any structural mutation (setOptions with a
    // structural key, addSeries, removeSeries).
    this.rebuildSeriesDerived();

    if (opts?.maxPoints != null && opts.maxPoints > 0) {
      for (const s of this.stores) s.initRing(opts.maxPoints);
      // v1.9.0: the series offscreen layer is allocated for ring/streaming
      // charts so series can redraw without repainting the frame.
      this.surface.enableSeriesLayer();
    }

    if (this.opts.yMin !== undefined || this.opts.yMax !== undefined) {
      if (this.opts.yMin !== undefined) this.gridDomainLeft.yMin = this.opts.yMin;
      if (this.opts.yMax !== undefined) this.gridDomainLeft.yMax = this.opts.yMax;
      if (this.opts.yMin !== undefined) this.gridDomainRight.yMin = this.opts.yMin;
      if (this.opts.yMax !== undefined) this.gridDomainRight.yMax = this.opts.yMax;
      this.gridPinned = true;
    }

    this.dirtyDomain = true;
    this.dirtyFrame = true;
    this.dirtySeries = true;
    this.attachEvents();
    this.applySystemTheme();
    this.ensureLiveRegion();
  }

  /**
   * Validate and normalize constructor options.
   * Warns on suspicious values and clamps/repairs where possible.
   */
  private validateOpts(): void {
    if (this.opts.maxPoints < 0) {
      console.warn(`[goro-charts] maxPoints must be >= 0, got ${this.opts.maxPoints}. Using 0.`);
      this.opts.maxPoints = 0;
    }
    if (this.opts.fontSize < 6) {
      console.warn(`[goro-charts] fontSize ${this.opts.fontSize} is very small. Minimum recommended: 6.`);
    }
    const pad = this.opts.padding;
    if (pad.some((p) => p < 0)) {
      console.warn(`[goro-charts] padding values must be >= 0, got [${pad}]. Clamping to 0.`);
      this.opts.padding = pad.map((p) => Math.max(0, p)) as [number, number, number, number];
    }
    if (this.opts.yMin !== undefined && this.opts.yMax !== undefined && this.opts.yMin >= this.opts.yMax) {
      console.warn(`[goro-charts] yMin (${this.opts.yMin}) must be < yMax (${this.opts.yMax}). Swapping.`);
      [this.opts.yMin, this.opts.yMax] = [this.opts.yMax, this.opts.yMin];
    }
    if (this.opts.xAxis.type !== undefined && !['linear', 'time', 'band'].includes(this.opts.xAxis.type)) {
      console.warn(`[goro-charts] xAxis.type "${this.opts.xAxis.type}" is invalid. Using "linear".`);
      this.opts.xAxis = { ...this.opts.xAxis, type: 'linear' };
    }
    if (this.opts.gapMode && !['break', 'connect', 'zero'].includes(this.opts.gapMode)) {
      console.warn(`[goro-charts] gapMode "${this.opts.gapMode}" is invalid. Using "break".`);
      this.opts.gapMode = 'break';
    }
    // Validate series configs
    for (let i = 0; i < this.seriesConfigs.length; i++) {
      const s = this.seriesConfigs[i];
      if (!s.name || s.name.trim() === '') {
        console.warn(`[goro-charts] series[${i}] name is empty. Using "Series ${i}".`);
        this.seriesConfigs[i] = { ...s, name: `Series ${i}` };
      }
      if (s.yAxis && s.yAxis !== 'left' && s.yAxis !== 'right') {
        console.warn(`[goro-charts] series[${i}] has invalid yAxis "${s.yAxis}". Using "left".`);
        this.seriesConfigs[i] = { ...s, yAxis: 'left' };
      }
      if (s.gapMode && !['break', 'connect', 'zero'].includes(s.gapMode)) {
        console.warn(
          `[goro-charts] series[${i}] has invalid gapMode "${s.gapMode}". Ignoring (chart default applies).`,
        );
        this.seriesConfigs[i] = { ...s, gapMode: undefined };
      }
    }
  }

  /**
   * Detect system accessibility preferences and adjust visual styles.
   * - prefers-reduced-motion → tracked via `reducedMotionMql.matches`
   *   (streaming/rAF continue normally; read the flag to suppress future
   *   transitions/animations)
   * - prefers-contrast: more → increase colour opacity
   * - forced-colors: active → use system CSS system colours
   *
   * Also registers a `change` listener on the reduced-motion MQL so the
   * preference is re-evaluated at runtime. The listener is removed in
   * {@link destroy}.
   */
  private applySystemTheme(): void {
    try {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotionMql = reducedMotion;
      reducedMotion.addEventListener('change', this.handleReducedMotionChange);

      const highContrast = window.matchMedia('(prefers-contrast: more)');
      if (highContrast.matches) {
        if (this.opts.gridColor === 'rgba(255,255,255,0.08)') this.opts.gridColor = 'rgba(255,255,255,0.25)';
        if (this.opts.textColor === 'rgba(255,255,255,0.5)') this.opts.textColor = 'rgba(255,255,255,0.8)';
      }

      const forcedColors = window.matchMedia('(forced-colors: active)');
      if (forcedColors.matches) {
        this.opts.textColor = 'CanvasText';
        this.opts.bgColor = 'Canvas';
        this.opts.gridColor = 'GrayText';
        this.opts.axisColor = 'GrayText';
        this.opts.crosshairColor = 'GrayText';
      }
    } catch {
      // matchMedia may not be available in all environments (SSR, jsdom)
    }
  }

  /**
   * Ensure an aria-live region exists for screen-reader announcements
   * of crosshair position values.
   */
  private ensureLiveRegion(): void {
    if (this.liveRegion) return;
    try {
      this.liveRegion = document.createElement('div');
      this.liveRegion.setAttribute('aria-live', 'polite');
      this.liveRegion.setAttribute('aria-atomic', 'true');
      this.liveRegion.style.cssText =
        'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;';
      this.surface.canvas.parentElement?.appendChild(this.liveRegion);
    } catch {
      // DOM may not be available in test environments
    }
  }

  /**
   * Update the canvas aria-label with a summary of visible data.
   * Called once per static redraw.
   */
  private updateAriaLabel(): void {
    const nonEmpty = this.stores
      .map((s, i) => ({ config: this.seriesConfigs[i], visible: this.isVisible(i), last: s.lastValue }))
      .filter((s) => s.visible);

    let label: string;
    if (nonEmpty.length === 0) {
      label = 'Chart: no data';
    } else {
      label = `Chart: ${nonEmpty.map((s) => `${s.config.name} ${formatNumber(s.last)}`).join(', ')}`;
    }
    this.surface.canvas.setAttribute('aria-label', label);
  }

  /**
   * Return the first non-empty series index, or -1 when all stores are empty.
   * Used as the reference for keyboard navigation — the cursor advances by
   * logical point indices of this series and the crosshair position is derived
   * from its X value at the current logical index.
   */
  private referenceSeriesIndex(): number {
    for (let i = 0; i < this.stores.length; i++) {
      if (this.isVisible(i)) return i;
    }
    return -1;
  }

  /**
   * Handle keyboard navigation for the crosshair.
   * - ArrowLeft / ArrowRight: move crosshair by 1 point (Shift: 10 points)
   * - Escape: hide crosshair
   *
   * Navigation is anchored to the logical index of the first non-empty series
   * (see {@link referenceSeriesIndex}). The pixel position is derived from the
   * point's X value via the grid domain so the cursor tracks data, not pixels.
   */
  private onKeyDown(e: KeyboardEvent): void {
    if (document.activeElement !== this.surface.canvas) return;

    const step = e.shiftKey ? 10 : 1;
    const ref = this.referenceSeriesIndex();
    if (ref < 0) return;

    const count = this.stores[ref].count;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        if (this.cursorLogical < 0 || this.cursorLogical >= count) {
          this.cursorLogical = count - 1;
        } else {
          this.cursorLogical = Math.max(0, this.cursorLogical - step);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (this.cursorLogical < 0 || this.cursorLogical >= count) {
          this.cursorLogical = 0;
        } else {
          this.cursorLogical = Math.min(count - 1, this.cursorLogical + step);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.showCrosshair = false;
        this.dirtyOverlay = true;
        this.draw();
        this.notifySyncCrosshairLeave();
        return;
      default:
        return;
    }

    // Convert the logical point index to a pixel X coordinate.
    const store = this.stores[ref];
    const xVal = store.xArr[store.physOf(this.cursorLogical)];
    const plot = this.plotRect();
    // Use the grid domain for the reference series axis.
    const axis = (this.seriesConfigs[ref].yAxis ?? 'left') === 'right' ? this.gridDomainRight : this.gridDomainLeft;
    this.cursorX = xToPx(xVal, axis, plot, this.opts.xAxis.type);
    this.showCrosshair = true;
    this.dirtyOverlay = true;
    this.draw();
    this.notifySyncCrosshair();
  }

  /** Reusable crosshair-sync helpers used by both mouse and keyboard handlers. */
  private notifySyncCrosshair(): void {
    // Only broadcast when the local cursor is inside the plot area — padding
    // and axes shouldn't inject a garbage data-X into peers.
    const plot = this.plotRect();
    if (
      this.cursorX < plot.x ||
      this.cursorX > plot.x + plot.w ||
      this.cursorY < plot.y ||
      this.cursorY > plot.y + plot.h
    ) {
      return;
    }
    const xVal = pxToX(this.cursorX, this.gridDomainLeft, plot, this.opts.xAxis.type);
    for (const target of this.syncTargets) target.injectCursor(xVal);
  }

  private notifySyncCrosshairLeave(): void {
    for (const target of this.syncTargets) target.injectCursorLeave();
  }

  /** Draw the series shape. Implemented by {@link LineChart} / {@link AreaChart}. */
  protected abstract renderSeries(
    ctx: CanvasRenderingContext2D,
    view: SeriesView,
    plot: PlotRect,
    opts: ResolvedOpts,
  ): void;

  // ---- Public data API -----------------------------------------------------

  /**
   * Snapshot mode: replace the series at `ref` (O(n) extent).
   * @param ref - Series index or id
   * @param x - X values, must be finite and monotonically increasing
   * @param y - Y values, may contain NaN (reserved for gaps v1.6.0); non-finite other than NaN is rejected
   * @param ownership - `'copy'` (default): store copies the arrays; `'borrowed'`: store keeps caller's arrays by reference (must be treated as immutable)
   * @throws {Error} if `ref` is unknown, length mismatch, empty, non-finite X, or non-monotonic X
   */
  setData(
    ref: SeriesRef,
    x: Float64Array<ArrayBufferLike>,
    y: Float64Array<ArrayBufferLike>,
    ownership?: DataOwnership,
  ): void {
    if (this.destroyed) return;
    const idx = this.resolveRef(ref);
    try {
      this.stores[idx].setData(x, y, ownership);
    } catch (e) {
      throw new Error(`series ${this.refLabel(ref)}: ${(e as Error).message}`, { cause: e });
    }
    this.gridPinned = false;
    this.reclampViewportToExtent();
    this.invalidate();
  }

  /**
   * Ring mode: append one sample to series `ref`.
   * @param ref - Series index or id
   * @param x - X value (must be finite and monotonically increasing)
   * @param y - Y value (NaN is allowed — reserved for gaps v1.6.0)
   * @throws {Error} if ring mode is not active (maxPoints not set)
   * @throws {Error} if `ref` is unknown, x is not finite, x is non-monotonic, or y is non-finite (NaN allowed)
   */
  append(ref: SeriesRef, x: number, y: number): void {
    if (this.destroyed) return;
    try {
      this.storeAt(ref).append(x, y);
    } catch (e) {
      throw new Error(`series ${this.refLabel(ref)}: ${(e as Error).message}`, { cause: e });
    }
    this.reclampViewportToExtent();
    this.dirtyDomain = true;
    this.dirtySeries = true;
    if (!this.autoDraw || this.suspendCount > 0) return;
    if (this.rafScheduled) return;
    this.rafScheduled = requestAnimationFrame(() => {
      this.rafScheduled = 0;
      this.draw();
    });
  }

  /**
   * Ring mode: append a batch of samples to series `ref`.
   * @param ref - Series index or id
   * @param xs - X values (must be finite and monotonically increasing)
   * @param ys - Y values (NaN is allowed — reserved for gaps v1.6.0)
   * @throws {Error} if ring mode is not active
   * @throws {Error} if `ref` is unknown, length mismatch, non-finite X, non-monotonic X, or non-finite Y (NaN allowed)
   */
  appendBatch(ref: SeriesRef, xs: ArrayLike<number>, ys: ArrayLike<number>): void {
    if (this.destroyed) return;
    try {
      this.storeAt(ref).appendBatch(xs, ys);
    } catch (e) {
      throw new Error(`series ${this.refLabel(ref)}: ${(e as Error).message}`, { cause: e });
    }
    this.reclampViewportToExtent();
    this.dirtyDomain = true;
    this.dirtySeries = true;
    if (!this.autoDraw || this.suspendCount > 0) return;
    if (this.rafScheduled) return;
    this.rafScheduled = requestAnimationFrame(() => {
      this.rafScheduled = 0;
      this.draw();
    });
  }

  /**
   * Ring mode: atomically append one sample per series in a single frame.
   *
   * **Alignment rule:** when a series is absent from `values` but has received
   * data before, its last `y` is carried forward at the common frame `x` so
   * every active series stays ring-aligned frame-by-frame (including hidden
   * series, so they re-appear in sync). Series that have never received data
   * are skipped.
   *
   * Validation is performed on the entire frame before any series is mutated,
   * so a failing frame leaves every series unchanged (atomic).
   *
   * @param x - Common x for all entries in this frame. Must be finite and
   *   monotonically increasing relative to each series' last x.
   * @param values - Map or record keyed by {@link SeriesRef} → y.
   *   Accepts `Map<SeriesRef, number>` or `Record<string, number>` (id → y).
   *   Refs that resolve to the same series are rejected.
   * @throws {Error} if ring mode is not active (`maxPoints` not set)
   * @throws {Error} if x is not finite
   * @throws {Error} if any ref is unknown, y is non-finite (NaN allowed),
   *   x is non-monotonic for a series, or the same series appears twice
   */
  appendFrame(x: number, values: ChartFrameValues): void {
    if (this.destroyed) return;
    const { maxPoints } = this.opts;
    if (maxPoints <= 0) throw new Error('appendFrame requires ring mode (maxPoints not set)');

    // ---- normalise values into uniform entries -------------------------------
    const entries: { ref: SeriesRef; y: number }[] = [];
    if (values instanceof Map) {
      for (const [ref, y] of values) entries.push({ ref, y });
    } else {
      for (const [id, y] of Object.entries(values)) entries.push({ ref: id, y });
    }
    if (entries.length === 0) return;

    if (!Number.isFinite(x)) {
      throw new Error(`appendFrame x=${x} is not finite`);
    }

    // ---- Phase 1: resolve + validate every entry (no mutation yet) ----------
    const parsed: { idx: number; y: number }[] = [];
    const present = new Set<number>(); // guard against duplicate series refs
    for (let i = 0; i < entries.length; i++) {
      const { ref, y } = entries[i];
      const idx = this.resolveRef(ref);
      const s = this.stores[idx];

      if (!s.isRing) {
        throw new Error(
          `appendFrame series ${this.refLabel(ref)}: ring mode not active. ` +
            `Create the chart with { maxPoints } to enable streaming.`,
        );
      }
      if (!(Number.isFinite(y) || Number.isNaN(y))) {
        throw new Error(`appendFrame y=${y} at entry ${i} is not finite`);
      }
      if (s.count > 0 && x < s.xMax) {
        throw new Error(
          `appendFrame series ${this.refLabel(ref)}: x=${x} < last x=${s.xMax}; x must be monotonically increasing`,
        );
      }
      if (present.has(idx)) {
        throw new Error(`appendFrame: duplicate series ref "${this.refLabel(ref)}" (resolves to same index ${idx})`);
      }
      present.add(idx);
      parsed.push({ idx, y });
    }

    // ---- Phase 2: carry-forward absent active series (incl. hidden) ---------
    let carried = 0;
    for (let i = 0; i < this.stores.length; i++) {
      if (present.has(i)) continue; // present in frame
      const s = this.stores[i];
      if (!s.isRing || s.count === 0) continue; // not ring or empty — skip
      if (x <= s.xMax) continue; // would violate monotonicity
      s.append(x, s.lastValue);
      carried++;
    }

    // ---- Phase 3: push validated entries ------------------------------------
    for (const { idx, y } of parsed) {
      this.stores[idx].append(x, y);
    }

    // ---- Phase 4: one invalidation, one event -------------------------------
    const seriesUpdated = parsed.length + carried;
    this.reclampViewportToExtent();
    this.dirtyDomain = true;
    this.dirtySeries = true;
    const render = this.autoDraw && this.suspendCount === 0;
    this.emit('frameappended', { seriesUpdated, render });
    if (render && !this.rafScheduled) {
      this.rafScheduled = requestAnimationFrame(() => {
        this.rafScheduled = 0;
        this.draw();
      });
    }
  }

  /**
   * Resize the streaming window (applies to all series).
   * Preserves the most recent samples in each series.
   * @param maxPoints - New window size (must be >= 1)
   */
  setMaxPoints(maxPoints: number): void {
    if (this.destroyed) return;
    for (const s of this.stores) s.setMaxPoints(maxPoints);
    // v1.9.0: lazily allocate the series offscreen layer on first ring
    // activation — static charts that never use streaming avoid the second
    // buffer entirely.
    if (maxPoints > 0) this.surface.enableSeriesLayer();
    this.reclampViewportToExtent();
    this.invalidate();
  }

  /** Empty all series and reset grid domain. */
  clear(): void {
    if (this.destroyed) return;
    for (const s of this.stores) s.clear();
    this.gridPinned = false;
    this.stackWarned.clear();
    this.reclampViewportToExtent();
    this.invalidate();
  }

  // ---- Runtime options & series management ---------------------------------

  /**
   * Set of top-level option keys whose change requires recomputing layout /
   * domain (as opposed to a purely visual repaint). `series` is classified
   * separately so visual-only per-series style changes can invalidate just the
   * series layer.
   */
  private static readonly STRUCTURAL_OPTION_KEYS = new Set<keyof ChartOpts>(['padding', 'yMin', 'yMax', 'maxPoints']);

  /**
   * Update chart options at runtime without recreating the chart.
   *
   * Visual-only changes (colours, font, crosshair style, tick counts) repaint
   * without touching the grid domain. Structural changes (`padding`, `yMin`/
   * `yMax`, `maxPoints`, or series topology/domain-affecting fields) recompute
   * the derived caches and re-anchor the grid so the layout reflows. Visual-only
   * series style changes invalidate the series layer without repainting the
   * frame.
   *
   * @param patch - Any subset of {@link ChartOpts}. When `series` is supplied
   *   it replaces the config array (use {@link addSeries} / {@link removeSeries}
   *   to change the series count).
   * @throws {Error} if `series` is replaced with a different length, or a
   *   duplicate `id` is introduced.
   */
  setOptions(patch: ChartOptionsPatch): void {
    if (this.destroyed) return;

    let structural = false;
    let seriesVisual = false;
    let seriesAffectsLegend = false;
    for (const key of Object.keys(patch) as (keyof ChartOpts)[]) {
      if (ChartBase.STRUCTURAL_OPTION_KEYS.has(key)) structural = true;
    }

    if (patch.series !== undefined) {
      if (patch.series.length !== this.seriesConfigs.length) {
        throw new Error(
          `setOptions: series length ${patch.series.length} must match current ${this.seriesConfigs.length}; ` +
            `use addSeries/removeSeries to change the count`,
        );
      }
      structural = structural || this.isSeriesPatchStructural(patch.series);
      seriesVisual = !structural;
      seriesAffectsLegend = seriesVisual && this.seriesPatchAffectsVisibleLegend(patch.series);
      this.seriesConfigs = patch.series;
    }

    // Merge the remaining top-level options (series handled above).
    const rest: ChartOptionsPatch = { ...patch };
    delete rest.series;
    this.opts = { ...this.opts, ...rest };

    if (structural) {
      this.rebuildSeriesDerived();
      this.gridPinned = false;
    }
    if (seriesVisual) {
      this.dirtySeries = true;
      if (seriesAffectsLegend) this.dirtyFrame = true;
      if (Object.keys(rest).length > 0) {
        this.invalidate('paint');
        return;
      }
      if (!this.autoDraw || this.suspendCount > 0) return;
      if (this.rafScheduled) return;
      this.rafScheduled = requestAnimationFrame(() => {
        this.rafScheduled = 0;
        this.draw();
      });
      return;
    }
    this.invalidate(structural ? 'layout' : 'paint');
  }

  /** True when a series patch can affect domain, grouping, lookup, or visibility. */
  private isSeriesPatchStructural(next: SeriesConfig[]): boolean {
    for (let i = 0; i < next.length; i++) {
      const prev = this.seriesConfigs[i];
      const cur = next[i];
      if (
        prev.id !== cur.id ||
        prev.yAxis !== cur.yAxis ||
        prev.stack !== cur.stack ||
        prev.yMin !== cur.yMin ||
        prev.yMax !== cur.yMax ||
        prev.hidden !== cur.hidden
      ) {
        return true;
      }
    }
    return false;
  }

  /** True when visual series edits affect the frame-layer legend. */
  private seriesPatchAffectsVisibleLegend(next: SeriesConfig[]): boolean {
    if (this.legendConfigs().length < 2) return false;
    for (let i = 0; i < next.length; i++) {
      const prev = this.seriesConfigs[i];
      const cur = next[i];
      if (prev.name !== cur.name || prev.color !== cur.color) return true;
    }
    return false;
  }

  /**
   * Append a new series at runtime.
   * @param config - The series configuration (may carry an `id`).
   * @returns The new series' index.
   * @throws {Error} if the `id` duplicates an existing series.
   */
  addSeries(config: SeriesConfig): number {
    if (this.destroyed) return -1;
    if (config.id !== undefined && this.seriesIndexById.has(config.id)) {
      throw new Error(`duplicate series id "${config.id}"`);
    }

    const store = new SeriesStore();
    if (this.opts.maxPoints > 0) store.initRing(this.opts.maxPoints);

    this.seriesConfigs = [...this.seriesConfigs, config];
    this.stores = [...this.stores, store];
    this.rebuildSeriesDerived(); // keeps the id map / stack caches canonical
    this.gridPinned = false;
    this.invalidate();
    return this.stores.length - 1;
  }

  /**
   * Remove a series at runtime. Frees its data and reflows the layout.
   * @param ref - Series index or id.
   * @throws {Error} if `ref` is unknown.
   */
  removeSeries(ref: SeriesRef): void {
    if (this.destroyed) return;
    const idx = this.resolveRef(ref);

    this.stores[idx].clear();
    this.seriesConfigs = this.seriesConfigs.filter((_, i) => i !== idx);
    this.stores = this.stores.filter((_, i) => i !== idx);

    // The logical keyboard cursor points at the reference series; reset it so a
    // stale index can't survive the reshuffle.
    this.cursorLogical = -1;

    this.rebuildSeriesDerived();
    this.gridPinned = false;
    this.stackWarned.clear();
    this.invalidate();
  }

  /**
   * Show a previously hidden series (clears its `hidden` flag).
   * @param ref - Series index or id.
   */
  showSeries(ref: SeriesRef): void {
    this.setSeriesHidden(ref, false);
  }

  /**
   * Hide a series: excluded from rendering, the grid domain, and the crosshair.
   * @param ref - Series index or id.
   */
  hideSeries(ref: SeriesRef): void {
    this.setSeriesHidden(ref, true);
  }

  private setSeriesHidden(ref: SeriesRef, hidden: boolean): void {
    if (this.destroyed) return;
    const idx = this.resolveRef(ref);
    if (!!this.seriesConfigs[idx].hidden === hidden) return; // no-op
    this.seriesConfigs[idx] = { ...this.seriesConfigs[idx], hidden };
    this.gridPinned = false;
    this.invalidate();
  }

  /** Number of series configured. */
  get seriesCount(): number {
    if (this.destroyed) return 0;
    return this.stores.length;
  }

  /**
   * Total points currently in the window across all series (before decimation).
   * Useful as a high-level data-volume indicator.
   */
  get windowPointCount(): number {
    if (this.destroyed) return 0;
    return this.stores.reduce((sum, s) => sum + s.count, 0);
  }

  /**
   * Estimated number of line segments actually drawn in the last render.
   * When a series has more than 2×plotW points, the renderer decimates to
   * ~2·plotW per-pixel-column segments (the `dense` regime). This property
   * mirrors that rule so you can verify decimation is active.
   *
   * Returns an upper bound (the real hardware draw count may be slightly
   * lower due to degenerate columns) — sufficient for debug/monitoring.
   */
  get drawnPointCount(): number {
    if (this.destroyed) return 0;
    const plotW = this.plotRect().w;
    if (plotW <= 0) return this.windowPointCount;
    return this.stores.reduce((sum, s) => {
      if (s.count === 0) return sum;
      return sum + (s.count > plotW * 2 ? Math.min(s.count, Math.ceil(plotW * 2)) : s.count);
    }, 0);
  }

  /**
   * Number of points currently in the window for series `ref`.
   * @param ref - Series index or id
   */
  pointCount(ref: SeriesRef): number {
    if (this.destroyed) return 0;
    return this.stores[this.resolveRef(ref)].count;
  }
  /**
   * Current window y minimum for series `ref` (O(1)).
   * @param ref - Series index or id
   */
  extentMin(ref: SeriesRef): number {
    if (this.destroyed) return NaN;
    return this.stores[this.resolveRef(ref)].yMin;
  }
  /**
   * Current window y maximum for series `ref` (O(1)).
   * @param ref - Series index or id
   */
  extentMax(ref: SeriesRef): number {
    if (this.destroyed) return NaN;
    return this.stores[this.resolveRef(ref)].yMax;
  }
  /**
   * Most recent y value for series `ref`, or NaN if empty.
   * @param ref - Series index or id
   */
  lastValue(ref: SeriesRef): number {
    if (this.destroyed) return NaN;
    return this.stores[this.resolveRef(ref)].lastValue;
  }

  /**
   * Pause rAF-coalesced drawing. Nestable — call {@link resumeDraw} the
   * same number of times to re-enable. Useful for bulk-loading data without
   * intermediate paints.
   */
  suspendDraw(): void {
    if (this.destroyed) return;
    this.suspendCount++;
  }
  /** Resume drawing after a matching {@link suspendDraw}. Draws immediately if dirty. */
  resumeDraw(): void {
    if (this.destroyed) return;
    if (this.suspendCount > 0) this.suspendCount--;
    if (this.suspendCount === 0 && (this.dirtyDomain || this.dirtyFrame || this.dirtySeries)) this.invalidate();
  }

  /**
   * Group several mutations into a single repaint. Drawing is suspended for the
   * duration of `fn` and resumed afterwards (even if `fn` throws), coalescing
   * every change into one frame.
   * @param fn - Callback performing the batched mutations.
   */
  batch(fn: () => void): void {
    if (this.destroyed) return;
    this.suspendDraw();
    try {
      fn();
    } finally {
      this.resumeDraw();
    }
  }

  /**
   * Export the current canvas as a PNG data URL.
   * @returns A `data:image/png` URL string
   */
  toImage(): string {
    if (this.destroyed) return '';
    return this.surface.canvas.toDataURL('image/png');
  }

  /**
   * Bidirectionally sync crosshair position with `other`. When the mouse
   * moves on one chart, crosshair overlay is injected on all synced charts
   * at the matching x coordinate.
   * @param other - Another chart instance to sync with
   */
  sync(other: ChartBase): void {
    if (this.destroyed) return;
    this.syncTargets.add(other);
    other.syncTargets.add(this);
  }

  /**
   * Remove bidirectional crosshair sync previously established with `other`.
   * No-op if the two charts were not synced.
   * @param other - Another chart instance to unsync from
   */
  unsync(other: ChartBase): void {
    if (this.destroyed) return;
    this.syncTargets.delete(other);
    other.syncTargets.delete(this);
  }

  // ---- Events (v1.5.0) -----------------------------------------------------

  /**
   * Register a typed listener for chart lifecycle and streaming events.
   * Listeners are automatically removed in {@link destroy}.
   * @param type - Event type (e.g. `'frameappended'`, `'destroy'`).
   * @param fn - Typed listener callback.
   */
  on<K extends ChartEventType>(type: K, fn: ChartEventListener<K>): void {
    if (this.destroyed) return;
    this.listeners[type].add(fn as ChartEventListener<ChartEventType>);
  }

  /**
   * Remove a previously registered listener.
   * @param type - Event type.
   * @param fn - The exact function reference passed to {@link on}.
   */
  off<K extends ChartEventType>(type: K, fn: ChartEventListener<K>): void {
    if (this.destroyed) return;
    this.listeners[type].delete(fn as ChartEventListener<ChartEventType>);
  }

  /**
   * Dispatch a typed event to every registered listener for `type`.
   * Subclasses and internal methods call this to publish lifecycle changes
   * without exposing a raw event emitter.
   */
  protected emit<K extends ChartEventType>(type: K, ev: ChartEventMap[K]): void {
    if (this.destroyed) return;
    const set = this.listeners[type];
    if (!set) return;
    for (const fn of set) fn(ev);
  }

  /**
   * External callback for hover events. Called on `mousemove` with the
   * interpolated data for every visible series. Use to build custom DOM
   * tooltips or bind to framework state — the Canvas tooltip still draws
   * unless suppressed externally.
   */
  onHover?: (hits: SeriesHit[]) => void;

  // ---- Viewport (v1.7.0) ----------------------------------------------------

  /**
   * Set a user-controlled X viewport. Overrides the chart's auto/streaming X
   * domain until {@link resetViewport} is called — see
   * {@link updateGridDomain} for the priority rule. Clamped to the union X
   * extent of the visible series; a window wider than the data collapses to
   * the full extent (equivalent to {@link resetViewport}).
   * @throws {Error} if `xMin`/`xMax` are not finite or `xMin >= xMax`.
   */
  setViewport(v: Viewport): void {
    if (this.destroyed) return;
    if (!Number.isFinite(v.xMin) || !Number.isFinite(v.xMax) || v.xMin >= v.xMax) {
      throw new Error('[goro-charts] setViewport requires finite xMin < xMax');
    }
    const extent = this.dataXExtent();
    let { xMin, xMax } = v;
    if (extent) {
      if (xMin <= extent.xMin && xMax >= extent.xMax) {
        this.resetViewport();
        return;
      }
      if (xMin < extent.xMin) {
        xMax = Math.min(extent.xMax, xMax + (extent.xMin - xMin));
        xMin = extent.xMin;
      }
      if (xMax > extent.xMax) {
        xMin = Math.max(extent.xMin, xMin - (xMax - extent.xMax));
        xMax = extent.xMax;
      }
    }
    // Preserve `yAuto` from either the incoming value or the current
    // viewport — a zoom-then-pan sequence shouldn't reset it, and applyZoom
    // / applyPan don't know about it (they only forward xMin/xMax).
    const yAuto = v.yAuto ?? this.viewport?.yAuto;
    this.viewport = yAuto !== undefined ? { xMin, xMax, yAuto } : { xMin, xMax };
    this.invalidate('layout');
    this.emit('viewportchange', { xMin, xMax });
  }

  /** Current viewport, or `null` when unset (auto/streaming domain). */
  getViewport(): Viewport | null {
    return this.viewport ? { ...this.viewport } : null;
  }

  /** Clear the viewport and restore the full data domain. */
  resetViewport(): void {
    if (this.destroyed) return;
    if (!this.viewport) return;
    this.viewport = null;
    this.invalidate('layout');
    const extent = this.dataXExtent();
    this.emit('viewportchange', extent ? { xMin: extent.xMin, xMax: extent.xMax } : { xMin: 0, xMax: 0 });
  }

  /**
   * v1.7.0: keep the viewport aligned with the data extent when streaming
   * (or any external mutation) slides it. Without this, an active viewport
   * whose window falls entirely outside the current ring buffer would leave
   * the chart pointing at empty space — nothing to draw, but the domain
   * still reports the stale window. The rule mirrors {@link applyPan}:
   *
   * - If the viewport still fits inside the extent, do nothing.
   * - If it collides with an edge, shift it back into range while
   *   preserving its width (streaming feel).
   * - If it's now wider than the extent, drop it and restore auto.
   *
   * Called by `append` / `appendBatch` / `appendFrame` / `setMaxPoints` /
   * `clear` after the store mutation. Emits `viewportchange` when the
   * viewport actually moved.
   */
  private reclampViewportToExtent(): void {
    if (!this.viewport) return;
    const extent = this.dataXExtent();
    if (!extent) {
      // No data left after mutation — restore full auto-domain.
      this.viewport = null;
      this.emit('viewportchange', { xMin: 0, xMax: 0 });
      return;
    }
    let { xMin, xMax } = this.viewport;
    const width = xMax - xMin;
    const extentWidth = extent.xMax - extent.xMin;
    if (width >= extentWidth) {
      // Window is now wider than the whole extent — auto is a better fit.
      this.viewport = null;
      this.emit('viewportchange', { xMin: extent.xMin, xMax: extent.xMax });
      return;
    }
    let moved = false;
    if (xMin < extent.xMin) {
      xMax += extent.xMin - xMin;
      xMin = extent.xMin;
      moved = true;
    }
    if (xMax > extent.xMax) {
      xMin -= xMax - extent.xMax;
      xMax = extent.xMax;
      moved = true;
    }
    if (xMin < extent.xMin) xMin = extent.xMin;
    if (xMax > extent.xMax) xMax = extent.xMax;
    if (!moved) return;
    const yAuto = this.viewport.yAuto;
    this.viewport = yAuto !== undefined ? { xMin, xMax, yAuto } : { xMin, xMax };
    this.emit('viewportchange', { xMin, xMax });
  }

  /** Union X extent of every visible series, or `null` when there is no visible data. */
  private dataXExtent(): { xMin: number; xMax: number } | null {
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < this.stores.length; i++) {
      if (!this.isVisible(i)) continue;
      const s = this.stores[i];
      if (s.xMin < xMin) xMin = s.xMin;
      if (s.xMax > xMax) xMax = s.xMax;
    }
    return xMin <= xMax ? { xMin, xMax } : null;
  }

  /**
   * Zoom around the data-x under `pxX` (a CSS-pixel X within the plot area)
   * by `factor` (`< 1` zooms in, `> 1` zooms out). The point under `pxX`
   * stays fixed on screen. Zooming out past the full data extent clears the
   * viewport.
   */
  private applyZoom(pxX: number, factor: number): void {
    const extent = this.dataXExtent();
    if (!extent) return;
    const cur = this.viewport ?? extent;
    if (cur.xMax <= cur.xMin) return;
    const plot = this.plotRect();
    const anchorX = pxToX(pxX, { xMin: cur.xMin, xMax: cur.xMax, yMin: 0, yMax: 0 }, plot, this.opts.xAxis.type);
    let nxMin = anchorX - (anchorX - cur.xMin) * factor;
    let nxMax = anchorX + (cur.xMax - anchorX) * factor;
    if (nxMin >= nxMax) return;
    if (nxMin <= extent.xMin && nxMax >= extent.xMax) {
      this.resetViewport();
      return;
    }
    if (nxMin < extent.xMin) nxMin = extent.xMin;
    if (nxMax > extent.xMax) nxMax = extent.xMax;
    if (nxMin >= nxMax) return;
    this.setViewport({ xMin: nxMin, xMax: nxMax });
  }

  /** Pan the current window by `dxPx` CSS pixels (positive = drag right = look further left). */
  private applyPan(dxPx: number): void {
    const extent = this.dataXExtent();
    if (!extent) return;
    const cur = this.viewport ?? extent;
    const range = cur.xMax - cur.xMin;
    if (range <= 0) return;
    const plot = this.plotRect();
    if (plot.w <= 0) return;
    const dx = -(dxPx / plot.w) * range;
    let nxMin = cur.xMin + dx;
    let nxMax = cur.xMax + dx;
    // Shift-clamp: preserve window width at the domain edges.
    if (nxMin < extent.xMin) {
      nxMax += extent.xMin - nxMin;
      nxMin = extent.xMin;
    }
    if (nxMax > extent.xMax) {
      nxMin -= nxMax - extent.xMax;
      nxMax = extent.xMax;
    }
    nxMin = Math.max(nxMin, extent.xMin);
    nxMax = Math.min(nxMax, extent.xMax);
    if (nxMin >= nxMax) return;
    this.setViewport({ xMin: nxMin, xMax: nxMax });
  }

  // ---- Rendering -----------------------------------------------------------

  /** Paint the chart. Cheap to call repeatedly: returns early when clean. */
  draw(): void {
    if (this.destroyed) return;

    // v1.9.0: streaming with active crosshair — data slides under the
    // stationary pointer, so hits/live-region need recompute every tick.
    // The plan phrases it as "dirtyOverlay=true mesmo sem evento de
    // movimento" (FASE 1.3).
    if (this.showCrosshair && this.dirtySeries) {
      this.dirtyOverlay = true;
    }

    const dirtyPaint = this.dirtyDomain || this.dirtyFrame || this.dirtySeries;
    const dirty = dirtyPaint || this.dirtyOverlay;
    // Nothing to paint and no stale crosshair to clean — bail early.
    if (!dirty && !this.showCrosshair && !this.crosshairPainted) return;

    const { cssW, cssH } = this.surface;
    if (cssW <= 0 || cssH <= 0) return;

    const plot = this.plotRect();
    if (plot.w <= 0 || plot.h <= 0) return;

    // Crosshair was hidden outside a streaming tick — re-blit the static
    // layer to clear the stale overlay immediately.
    if (!dirty && !this.showCrosshair && this.crosshairPainted) {
      this.surface.blit();
      this.crosshairPainted = false;
      if (this.onHover) this.onHover([]);
      return;
    }

    if (this.dirtyDomain) {
      this.updateGridDomain();
    }

    // v1.9.0: two fast-path sub-cases (Item 6 of the plan).
    //
    //   (a) "Pleno" — the tick VALUE SET is unchanged (grade fixa: gridPinned
    //       + !streaming, fixed viewport, or a sliding window that preserves
    //       the same tick values). The frame layer is not touched. Visually
    //       the grid lines may sit at a slightly different sub-pixel
    //       position (in streaming-ring sliding) but the bitmap remains
    //       correct at label resolution — a conscious trade of imperceptible
    //       precision for large CPU savings. This is what makes the
    //       D1-slide target achievable.
    //
    //   (b) "Reposicionamento" — the tick SET changed (a value fell off,
    //       a new value entered). The frame layer is redrawn. The
    //       TickCache stores labels per-value so `formatTimeTick` /
    //       `formatNumber` / `Intl` are called only for the ONE genuinely
    //       new tick value — the other 4-9 label strings are reused.
    if (dirtyPaint) {
      const before = this.tickCache.snapshotKeys();
      this.tickCache.refresh(this.gridDomainLeft, this.hasRightAxis ? this.gridDomainRight : null, this.opts);
      if (this.tickCache.keysChanged(before)) {
        this.dirtyFrame = true;
      }
    }

    // v1.9.0: mark domain as processed BEFORE series rendering so
    // renderSeriesLayer's `allCanAppend` sees dirtyDomain=false.
    // (updateGridDomain already ran; tickCache already refreshed above.)
    this.dirtyDomain = false;

    // Static path: without a series offscreen layer, series must paint into
    // the frame buffer — so any dirty series forces a frame redraw too.
    if (!this.surface.seriesLayerEnabled && this.dirtySeries) {
      this.dirtyFrame = true;
    }

    if (this.dirtyFrame) {
      this.renderFrameLayer(plot);
    }
    if (this.dirtySeries) {
      this.renderSeriesLayer(plot);
    }

    // Recompose the visible canvas whenever any layer or the overlay
    // changed. This includes the pure crosshair-move case (dirtyOverlay
    // only), which needs the visible canvas cleared before the crosshair
    // re-draws over the cached layers.
    if (dirtyPaint || this.dirtyOverlay) {
      this.composeLayers();
    }

    if (this.showCrosshair) {
      this.renderOverlay(plot);
    } else if (this.liveRegion) {
      this.liveRegion.textContent = '';
    }

    if (this.dirtyFrame || this.dirtySeries) {
      this.updateAriaLabel();
    }

    // Only clear the flags we actually acted on.
    this.dirtyFrame = false;
    this.dirtySeries = false;
    this.dirtyOverlay = false;
    this.crosshairPainted = this.showCrosshair;
  }

  /** Detach observers/listeners and release buffers. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.emit('destroy', {});
    this.destroyed = true;
    // Clear listeners after emit so the destroy event reaches them.
    this.listeners.frameappended.clear();
    this.listeners.destroy.clear();
    this.listeners.viewportchange.clear();
    if (this.rafScheduled) {
      cancelAnimationFrame(this.rafScheduled);
      this.rafScheduled = 0;
    }
    if (this.interactionRafId) {
      cancelAnimationFrame(this.interactionRafId);
      this.interactionRafId = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.reducedMotionMql?.removeEventListener('change', this.handleReducedMotionChange);
    this.reducedMotionMql = null;
    this.surface.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.surface.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.surface.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.surface.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.surface.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.surface.canvas.removeEventListener('wheel', this.handleWheel);
    this.surface.canvas.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('scroll', this.handleWindowLayoutShift, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', this.handleWindowLayoutShift);
    this.liveRegion?.remove();
    this.liveRegion = null;
    // Remove this chart from every peer's sync set to avoid dangling refs.
    for (const target of this.syncTargets) target.syncTargets.delete(this);
    this.syncTargets.clear();
    this.surface.dispose();
    this.stores = [];
  }

  // ---- Internals -----------------------------------------------------------

  /**
   * v1.9.0: render the FRAME layer to the frame offscreen buffer.
   *
   * Background, grid, axes, labels, legend — everything outside the series
   * clip. Called only when {@link dirtyFrame} is true (tick set changed,
   * palette/font/axis options changed, or first paint).
   */
  private renderFrameLayer(plot: PlotRect): void {
    const ctx = this.surface.frameContext();
    const { cssW, cssH } = this.surface;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = this.opts.bgColor;
    ctx.fillRect(0, 0, cssW, cssH);

    if (this.stores.every((_, i) => !this.isVisible(i))) return;

    renderGrid(ctx, this.gridDomainLeft, plot, this.opts, this.tickCache);
    renderAxes(ctx, this.gridDomainLeft, plot, this.opts, 'left', this.tickCache);
    if (this.hasRightAxis) {
      renderAxes(ctx, this.gridDomainRight, plot, this.opts, 'right', this.tickCache);
    }

    // Legend lives on the frame layer, OUTSIDE the series clip
    // (no clip — the legend may extend beyond plot boundaries).
    renderLegend(ctx, this.legendConfigs(), plot, this.opts);
  }

  /**
   * v1.9.0: render the SERIES layer to the series offscreen buffer (or to
   * the frame buffer when the series layer is disabled).
   *
   * All series paths with the plot clip applied. Called only when
   * {@link dirtySeries} is true (data mutation).
   */
  private renderSeriesLayer(plot: PlotRect): void {
    const ctx = this.surface.seriesContext();
    if (ctx) {
      // Series layer exists: clear only the series buffer, then draw.
      const { cssW, cssH } = this.surface;
      ctx.clearRect(0, 0, cssW, cssH);
      this.renderSeriesTo(ctx, plot);
    } else {
      // Static chart path: draw series directly into the frame buffer
      // (the only offscreen). The frame layer already cleared and drew
      // bg/grid/axes/legend, so series paint on top of that.
      this.renderSeriesTo(this.surface.frameContext(), plot);
    }
  }

  /**
   * Shared series rendering body used by both the dedicated series layer
   * and the unified static path. Applies the {@link plot} clip, iterates
   * non-stacked + stacked series, then restores.
   */
  private renderSeriesTo(ctx: CanvasRenderingContext2D, plot: PlotRect): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();

    // Detect stack groups.
    const { groups: stackGroups, stacked: stackedIndices } = this.detectAllStackGroups();

    // Non-stacked series.
    for (let i = 0; i < this.stores.length; i++) {
      if (stackedIndices.has(i)) continue;
      if (!this.isVisible(i)) continue;
      const store = this.stores[i];
      this.renderOne(ctx, i, store, store.yArr, plot);
    }

    // Stacked groups: build stores + styles arrays, delegate to band renderer.
    for (const [, grp] of stackGroups) {
      if (grp.length < 2) {
        for (const idx of grp) {
          if (this.isVisible(idx)) this.renderOne(ctx, idx, this.stores[idx], this.stores[idx].yArr, plot);
        }
        continue;
      }
      const bandStores: SeriesView[] = [];
      const bandStyles: { lineColor: string; lineWidth: number; fillColor: string; fillOpacity: number }[] = [];
      for (const idx of grp) {
        if (!this.isVisible(idx)) continue;
        const s = this.stores[idx];
        const cfg = this.seriesConfigs[idx];
        bandStores.push(s);
        bandStyles.push({
          lineColor: cfg.color,
          lineWidth: cfg.lineWidth ?? this.opts.lineWidth,
          fillColor: cfg.fillColor ?? this.opts.fillColor,
          fillOpacity: cfg.fillOpacity ?? this.opts.fillOpacity,
        });
      }
      if (bandStores.length < 2) {
        for (let i = 0; i < bandStores.length; i++) {
          this.renderOne(ctx, grp[i], bandStores[i], bandStores[i].yArr, plot);
        }
        continue;
      }
      const dom = (this.seriesConfigs[grp[0]].yAxis ?? 'left') === 'right' ? this.gridDomainRight : this.gridDomainLeft;
      renderStackedBands(ctx, bandStores, bandStyles, plot, dom);
    }

    ctx.restore();
  }

  /** Compose the offscreen layers onto the visible canvas. */
  private composeLayers(): void {
    this.surface.blit();
  }

  /**
   * Render the crosshair overlay on the visible canvas (on top of the
   * composed frame + series layers). Also fires the `onHover` callback and
   * updates the screen-reader live region.
   */
  private renderOverlay(plot: PlotRect): void {
    const crosshairViews = this.buildCrosshairViews();

    if (this.onHover || this.liveRegion) {
      const hits = computeHits(crosshairViews, this.seriesConfigs, plot, this.cursorX, this.opts.xAxis.type);
      if (this.onHover && hits.length > 0) this.onHover(hits);
      if (this.liveRegion) {
        this.liveRegion.textContent =
          hits.length > 0 ? hits.map((h) => `${h.label}: ${formatNumber(h.yVal)}`).join(', ') : '';
      }
    }

    renderCrosshair(
      this.surface.ctx,
      crosshairViews,
      this.seriesConfigs,
      plot,
      this.opts,
      { x: this.cursorX, y: this.cursorY },
      this.surface.cssW,
    );
  }

  /**
   * v1.7.0: pooled proxy views for `renderOne` and `buildCrosshairViews`.
   *
   * The old `makeView` used `Object.assign(Object.create(prototype), …)`,
   * allocating N objects per frame (one per series, plus another N when the
   * crosshair was on). Under a wheel-zoom or drag-pan gesture that's 60 ×
   * 2N allocations per second — enough GC pressure to visibly stall on
   * mid-tier hardware.
   *
   * Instead each `ChartBase` owns two pools of {@link PooledView} instances:
   *   - `viewSlotRender`: a single reusable slot used sequentially by
   *     `renderOne` (each call publishes → renders → the next call
   *     overwrites; the slot never escapes the render loop).
   *   - `viewPoolCrosshair`: N slots (grows on demand), one per series,
   *     because `buildCrosshairViews` returns an array whose entries
   *     coexist during `computeHits` + `renderCrosshair`.
   *
   * `PooledView` implements the `SeriesView` contract by delegating
   * `physOf` / `bracketLogical` to the bound store, so ring wraparound
   * still works. All other fields are plain data.
   */
  private readonly viewSlotRender = new PooledView();
  private viewPoolCrosshair: PooledView[] = [];

  /**
   * Populate the single render slot from `store` + explicit bounds and return
   * it. Caller must consume the view before calling {@link viewForRender}
   * again. `yArrOverride` swaps the Y array (used for stacked bands' Y).
   *
   * Scalars, not a `Domain` object, so this can be called from the hot draw
   * loop without allocating a fresh literal per series per frame.
   */
  private viewForRender(
    store: SeriesView,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    yArrOverride?: Float64Array<ArrayBufferLike>,
  ): SeriesView {
    return this.viewSlotRender.bind(store, xMin, xMax, yMin, yMax, yArrOverride);
  }

  /**
   * Return crosshair pool slot `i`, populating it from `store` + explicit
   * bounds. The pool grows on demand and is reused across frames.
   */
  private viewForCrosshair(
    i: number,
    store: SeriesView,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    yArrOverride?: Float64Array<ArrayBufferLike>,
  ): SeriesView {
    let slot = this.viewPoolCrosshair[i];
    if (!slot) {
      slot = new PooledView();
      this.viewPoolCrosshair[i] = slot;
    }
    return slot.bind(store, xMin, xMax, yMin, yMax, yArrOverride);
  }

  /** Render a single series. */
  private renderOne(
    ctx: CanvasRenderingContext2D,
    i: number,
    store: SeriesView,
    yArr: Float64Array<ArrayBufferLike>,
    plot: PlotRect,
  ): void {
    const cfg = this.seriesConfigs[i];
    const sOpts: ResolvedOpts = {
      ...this.opts,
      lineColor: cfg.color,
      lineWidth: cfg.lineWidth ?? this.opts.lineWidth,
      fillColor: cfg.fillColor ?? this.opts.fillColor,
      fillOpacity: cfg.fillOpacity ?? this.opts.fillOpacity,
      gapMode: cfg.gapMode ?? this.opts.gapMode,
    };

    if (cfg.dash) ctx.setLineDash(cfg.dash);

    const dom = (cfg.yAxis ?? 'left') === 'right' ? this.gridDomainRight : this.gridDomainLeft;
    let viewYMin = dom.yMin;
    let viewYMax = dom.yMax;
    if (cfg.yMin != null) viewYMin = cfg.yMin;
    if (cfg.yMax != null) viewYMax = cfg.yMax;

    const proxyView = this.viewForRender(store, dom.xMin, dom.xMax, viewYMin, viewYMax, yArr);
    this.renderSeries(ctx, proxyView, plot, sOpts);

    if (cfg.dash) ctx.setLineDash([]);
  }

  /** Cached per-axis stack groups (computed once in the constructor). */
  private detectStackGroupsOnAxis(axis: 'left' | 'right'): { groups: Map<string, number[]>; stacked: Set<number> } {
    return this.stackGroupsByAxis[axis];
  }

  /**
   * Compute stack groups for a given axis. Returns the group map and a set
   * of series indices that belong to groups with 2+ members.
   */
  private computeStackGroupsOnAxis(axis: 'left' | 'right'): { groups: Map<string, number[]>; stacked: Set<number> } {
    const groups = new Map<string, number[]>();
    const stacked = new Set<number>();
    for (let i = 0; i < this.stores.length; i++) {
      if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
      const g = this.seriesConfigs[i].stack;
      if (g) {
        let grp = groups.get(g);
        if (!grp) {
          grp = [];
          groups.set(g, grp);
        }
        grp.push(i);
      }
    }
    for (const grp of groups.values()) {
      if (grp.length >= 2) for (const idx of grp) stacked.add(idx);
    }
    return { groups, stacked };
  }

  /** Cached all-axis stack groups (computed once in the constructor). */
  private detectAllStackGroups(): {
    groups: Map<string, number[]>;
    stacked: Set<number>;
  } {
    return this.stackGroupsAll;
  }

  /**
   * Compute all stack groups across all axes.
   * Unlike {@link computeStackGroupsOnAxis}, this ignores the yAxis setting
   * and returns every group that has 2+ members.
   */
  private computeAllStackGroups(): {
    groups: Map<string, number[]>;
    stacked: Set<number>;
  } {
    const groups = new Map<string, number[]>();
    const stacked = new Set<number>();
    for (let i = 0; i < this.stores.length; i++) {
      const g = this.seriesConfigs[i].stack;
      if (g) {
        let grp = groups.get(g);
        if (!grp) {
          grp = [];
          groups.set(g, grp);
        }
        grp.push(i);
      }
    }
    for (const grp of groups.values()) {
      if (grp.length >= 2) for (const idx of grp) stacked.add(idx);
    }
    return { groups, stacked };
  }

  /**
   * Validate that all series within each stack group share the same axis.
   * Runs once in the constructor — axis assignment is immutable after that.
   * Data-length alignment is validated separately at draw time in
   * {@link accumulateStackGroup}, since counts change as data arrives.
   * Warns in development — mixed-axis stacking produces incorrect output.
   */
  private validateStackGroups(): void {
    for (let i = 0; i < this.stores.length; i++) {
      const g = this.seriesConfigs[i].stack;
      if (!g) continue;
      for (let j = i + 1; j < this.stores.length; j++) {
        if (this.seriesConfigs[j].stack !== g) continue;
        const axisI = this.seriesConfigs[i].yAxis ?? 'left';
        const axisJ = this.seriesConfigs[j].yAxis ?? 'left';
        if (axisI !== axisJ) {
          console.warn(
            `[goro-charts] stack group "${g}" mixes axis ${axisI} (series ${i}) and ${axisJ} (series ${j}). ` +
              `All series in a stack group must share the same yAxis.`,
          );
        }
      }
    }
  }

  /**
   * Compute accumulated Y values across a stack group, separating positive
   * and negative contributions.
   *
   * Positive values accumulate upward from 0 (`posCum`); negative values
   * accumulate downward from 0 (`negCum`). This prevents positive and negative
   * series from cancelling each other in the same accumulation track.
   *
   * Returns `{ posCum, negCum }` where each is `null` when no value of that
   * sign exists, or the cumulative `Float64Array` (length = n).
   */
  private accumulateStackGroup(indices: number[]): { posCum: Float64Array | null; negCum: Float64Array | null } {
    // Only visible members contribute; a hidden series is excluded from the
    // accumulation (and hence the domain) exactly like an empty one.
    const visible = indices.filter((idx) => !this.seriesConfigs[idx].hidden);
    if (visible.length === 0) return { posCum: null, negCum: null };

    const n = this.stores[visible[0]].count;
    if (n === 0) return { posCum: null, negCum: null };

    // Validate data-length alignment at runtime. accumulateStackGroup runs
    // multiple times per draw, so warn once per (group, series) pair.
    for (const idx of visible) {
      if (this.stores[idx].count !== n && this.stores[idx].count > 0) {
        const key = `len:${visible.join(',')}:${idx}:${this.stores[idx].count}:${n}`;
        if (!this.stackWarned.has(key)) {
          this.stackWarned.add(key);
          console.warn(
            `[goro-charts] stack accumulation skipped series ${idx}: count=${this.stores[idx].count} ` +
              `doesn't match group length ${n}.`,
          );
        }
      }
    }

    const runningPos = new Float64Array(n);
    const runningNeg = new Float64Array(n);
    let hasPos = false;
    let hasNeg = false;

    for (const idx of visible) {
      const s = this.stores[idx];
      if (s.count !== n) continue; // skip misaligned series
      let p = s.head;
      let toWrap = s.cap - s.head;
      for (let j = 0; j < n; j++) {
        const v = s.yArr[p];
        // NaN (v1.6.0 gap) fails both comparisons, so it silently
        // contributes 0 here — same documented stacking-gap contract as
        // renderStackedBands, and never poisons runningPos/runningNeg.
        if (v > 0) {
          runningPos[j] += v;
          hasPos = true;
        } else if (v < 0) {
          runningNeg[j] += v;
          hasNeg = true;
        }
        if (--toWrap === 0) {
          p = 0;
          toWrap = s.cap;
        } else p++;
      }
    }
    return {
      posCum: hasPos ? runningPos : null,
      negCum: hasNeg ? runningNeg : null,
    };
  }

  /**
   * Update the grid Y domain.
   *
   * Two regimes:
   *  - **Snapshot mode:** anchor the grid so it only expands, never shrinks.
   *    The domain snaps to the union extent on the first draw and stays frozen
   *    until a series exceeds it, then expands with a 10 % margin — a stable
   *    visual anchor for static data.
   *  - **Ring (streaming) mode:** the window slides, so the true extent both
   *    grows and shrinks as samples enter and leave. Here we recompute the
   *    domain from the current window every tick (via {@link initDomain}) so
   *    the grid tracks the visible data instead of drifting or letting stacked
   *    bands overflow the frame.
   *
   * If the user supplied `yMin` / `yMax` those are hard bounds that override
   * the auto logic in either regime.
   */
  private updateGridDomain(): void {
    if (this.stores.every((_, i) => !this.isVisible(i))) return;

    const userYMin = this.opts.yMin;
    const userYMax = this.opts.yMax;
    const fixedY = userYMin !== undefined || userYMax !== undefined;
    const streaming = this.stores.some((s) => s.isRing);

    const applyUserBounds = () => {
      if (!fixedY) return;
      if (userYMin !== undefined) {
        this.gridDomainLeft.yMin = userYMin;
        this.gridDomainRight.yMin = userYMin;
      }
      if (userYMax !== undefined) {
        this.gridDomainLeft.yMax = userYMax;
        this.gridDomainRight.yMax = userYMax;
      }
    };

    // v1.7.0: the user viewport is the highest-priority source of truth for
    // X. It must win at the entry — never as another `if` nested inside the
    // streaming/fixedY/gridPinned logic below — so it can't drift out of
    // sync with those regimes.
    if (this.viewport) {
      // Start from the full-data extent so any axis without windowed data
      // (empty on this axis, or with stacked-only series) still has a sane
      // Y domain. initDomain also writes X from the data extent; overwrite
      // it with the viewport's X afterwards.
      this.initDomain(this.gridDomainLeft, 'left', streaming ? 0.05 : 0);
      if (this.hasRightAxis) this.initDomain(this.gridDomainRight, 'right', streaming ? 0.05 : 0);

      // v1.7.0: unless the viewport opts out (`yAuto: false`), rescale Y to
      // the samples visible inside `[xMin, xMax]`. Without this, zooming
      // into a small feature keeps Y anchored to the global peak and the
      // feature looks flat — the visible reason users describe zoom as
      // "not doing anything".
      if (this.viewport.yAuto !== false) {
        const vx = this.viewport;
        const yl = this.computeWindowedYExtent('left', vx.xMin, vx.xMax);
        if (yl) {
          const margin = streaming ? 0.05 : 0;
          const pad = margin > 0 && yl.yMax > yl.yMin ? (yl.yMax - yl.yMin) * margin : 0;
          this.gridDomainLeft.yMin = yl.yMin - pad;
          this.gridDomainLeft.yMax = yl.yMax + pad;
        }
        if (this.hasRightAxis) {
          const yr = this.computeWindowedYExtent('right', vx.xMin, vx.xMax);
          if (yr) {
            const margin = streaming ? 0.05 : 0;
            const pad = margin > 0 && yr.yMax > yr.yMin ? (yr.yMax - yr.yMin) * margin : 0;
            this.gridDomainRight.yMin = yr.yMin - pad;
            this.gridDomainRight.yMax = yr.yMax + pad;
          }
        }
      }

      this.gridDomainLeft.xMin = this.viewport.xMin;
      this.gridDomainLeft.xMax = this.viewport.xMax;
      this.gridDomainRight.xMin = this.viewport.xMin;
      this.gridDomainRight.xMax = this.viewport.xMax;
      applyUserBounds();
      this.gridPinned = true;
      return;
    }

    // Streaming: recompute the window extent every tick so the grid tracks the
    // sliding window (shrinks as well as grows). Fixed bounds still win. A
    // small margin keeps peaks/troughs off the frame edge.
    if (streaming && !fixedY) {
      this.initDomain(this.gridDomainLeft, 'left', 0.05);
      if (this.hasRightAxis) this.initDomain(this.gridDomainRight, 'right', 0.05);
      this.refreshXDomain();
      this.gridPinned = true;
      return;
    }

    if (!this.gridPinned) {
      // First draw: compute union per axis from data, respecting any user bounds.
      this.initDomain(this.gridDomainLeft, 'left');
      if (this.hasRightAxis) this.initDomain(this.gridDomainRight, 'right');
      applyUserBounds();
      this.refreshXDomain();
      this.gridPinned = true;
      return;
    }

    // Refresh X every tick; Y expands only when data exceeds bounds.
    this.refreshXDomain();
    if (fixedY) return; // hard-locked — no expansion
    this.expandDomain(this.gridDomainLeft, 'left');
    if (this.hasRightAxis) this.expandDomain(this.gridDomainRight, 'right');
  }

  /**
   * Compute the domain for one axis from the current window.
   * @param margin optional fraction of the Y range to pad on each side
   *   (used in streaming mode so peaks/troughs don't touch the frame).
   */
  /**
   * v1.7.0: compute Y extent restricted to `[xMin, xMax]` for the given
   * axis. Used by {@link updateGridDomain} when the viewport is active and
   * `Viewport.yAuto !== false`, so zooming into a small feature makes it
   * fill the plot vertically instead of staying flat against the global
   * peak.
   *
   * Covers both non-stacked series (per-sample Y) and stacked groups
   * (per-index cumulative Y summed across layers, matching
   * {@link renderStackedBands}). Positive and negative accumulators are
   * tracked separately to mirror `accumulateStackGroup` — a group with
   * mixed-sign layers reports the full min→max of the stacked envelope.
   *
   * Returns `null` when the window contains no finite samples (e.g. all-NaN
   * or empty). Caller falls back to the full-data extent in that case.
   */
  private computeWindowedYExtent(
    axis: 'left' | 'right',
    xMin: number,
    xMax: number,
  ): { yMin: number; yMax: number } | null {
    let yMin = Infinity;
    let yMax = -Infinity;
    let found = false;
    const { groups, stacked } = this.detectStackGroupsOnAxis(axis);

    // Non-stacked series: raw Y per sample.
    for (let i = 0; i < this.stores.length; i++) {
      if (stacked.has(i)) continue;
      if (!this.isVisible(i)) continue;
      if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
      const s = this.stores[i];
      if (s.count === 0) continue;
      const iStart = s.bracketLogical(xMin);
      const iEnd = s.bracketLogical(xMax);
      // Scan the closed range [iStart, iEnd] over logical order, honouring
      // ring wraparound via physOf. NaN samples (v1.6.0 gaps) are skipped.
      for (let j = iStart; j <= iEnd; j++) {
        const p = s.physOf(j);
        const y = s.yArr[p];
        if (!Number.isFinite(y)) continue;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
        found = true;
      }
    }

    // Stacked groups: cumulative Y per index over the window. Only counts
    // the group when all members have matching counts (same alignment rule
    // as accumulateStackGroup — misaligned groups fall back to per-layer
    // above via the `stacked` set membership being applied per index).
    for (const [, grp] of groups) {
      if (grp.length < 2) continue;
      // All group members must be visible AND aligned to be counted here.
      let refCount = -1;
      let anyInvisible = false;
      for (const idx of grp) {
        if (!this.isVisible(idx)) {
          anyInvisible = true;
          break;
        }
        const s = this.stores[idx];
        if (refCount < 0) refCount = s.count;
        else if (s.count !== refCount) {
          anyInvisible = true;
          break;
        }
      }
      if (anyInvisible || refCount <= 0) continue;

      const first = this.stores[grp[0]];
      const iStart = first.bracketLogical(xMin);
      const iEnd = first.bracketLogical(xMax);
      if (iStart > iEnd) continue;

      // Per-index positive/negative accumulators over the window. NaN is
      // treated as 0 for accumulation (documented gap contract §6.4).
      const nVis = iEnd - iStart + 1;
      const pos = new Float64Array(nVis);
      const neg = new Float64Array(nVis);
      for (const idx of grp) {
        const s = this.stores[idx];
        let p = s.physOf(iStart);
        let toWrap = s.cap - p;
        for (let j = 0; j < nVis; j++) {
          const v = s.yArr[p];
          if (Number.isFinite(v)) {
            if (v >= 0) pos[j] += v;
            else neg[j] += v;
          }
          if (--toWrap === 0) {
            p = 0;
            toWrap = s.cap;
          } else p++;
        }
      }
      for (let j = 0; j < nVis; j++) {
        const hi = pos[j];
        const lo = neg[j];
        if (hi > yMax) yMax = hi;
        if (lo < yMin) yMin = lo;
        // A pure-positive stack still needs 0 in the domain so the base
        // baseline is visible; same for pure-negative.
        found = true;
      }
      if (found) {
        if (yMin > 0) yMin = 0;
        if (yMax < 0) yMax = 0;
      }
    }

    return found ? { yMin, yMax } : null;
  }

  private initDomain(d: Domain, axis: 'left' | 'right', margin = 0): void {
    d.xMin = Infinity;
    d.xMax = -Infinity;
    d.yMin = Infinity;
    d.yMax = -Infinity;

    const { groups, stacked } = this.detectStackGroupsOnAxis(axis);

    // Stacked groups: compute extent from accumulated Y.
    for (const [, grp] of groups) {
      if (grp.length < 2) continue;
      const { posCum, negCum } = this.accumulateStackGroup(grp);
      if (!posCum && !negCum) continue;
      let yMin = Infinity;
      let yMax = -Infinity;
      // Also collect x extents from the group (visible members only)
      for (const idx of grp) {
        if (!this.isVisible(idx)) continue;
        const s = this.stores[idx];
        if (s.xMin < d.xMin) d.xMin = s.xMin;
        if (s.xMax > d.xMax) d.xMax = s.xMax;
      }
      const scan = (arr: Float64Array) => {
        for (let j = 0; j < arr.length; j++) {
          if (arr[j] < yMin) yMin = arr[j];
          if (arr[j] > yMax) yMax = arr[j];
        }
      };
      if (posCum) scan(posCum);
      if (negCum) scan(negCum);
      if (yMin < d.yMin) d.yMin = yMin;
      if (yMax > d.yMax) d.yMax = yMax;
    }

    // Non-stacked series on this axis.
    for (let i = 0; i < this.stores.length; i++) {
      if (stacked.has(i)) continue;
      if (!this.isVisible(i)) continue;
      if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
      const s = this.stores[i];
      if (s.xMin < d.xMin) d.xMin = s.xMin;
      if (s.xMax > d.xMax) d.xMax = s.xMax;
      if (s.yMin < d.yMin) d.yMin = s.yMin;
      if (s.yMax > d.yMax) d.yMax = s.yMax;
    }

    // Optional breathing room so extremes don't sit on the frame edge.
    if (margin > 0 && d.yMax > d.yMin) {
      const pad = (d.yMax - d.yMin) * margin;
      d.yMin -= pad;
      d.yMax += pad;
    }
  }

  private expandDomain(d: Domain, axis: 'left' | 'right'): void {
    const yr = d.yMax - d.yMin || 1;
    const { groups, stacked } = this.detectStackGroupsOnAxis(axis);
    let changed = false;

    // Stacked groups: expand if accumulated Y exceeds domain.
    for (const [, grp] of groups) {
      if (grp.length < 2) continue;
      const { posCum, negCum } = this.accumulateStackGroup(grp);
      if (!posCum && !negCum) continue;
      let accMin = Infinity;
      let accMax = -Infinity;
      const scan = (arr: Float64Array) => {
        for (let j = 0; j < arr.length; j++) {
          if (arr[j] < accMin) accMin = arr[j];
          if (arr[j] > accMax) accMax = arr[j];
        }
      };
      if (posCum) scan(posCum);
      if (negCum) scan(negCum);
      if (accMin < d.yMin) {
        d.yMin = accMin - yr * 0.1;
        changed = true;
      }
      if (accMax > d.yMax) {
        d.yMax = accMax + yr * 0.1;
        changed = true;
      }
    }

    // Non-stacked series on this axis.
    for (let i = 0; i < this.stores.length; i++) {
      if (stacked.has(i)) continue;
      if (!this.isVisible(i)) continue;
      if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
      const s = this.stores[i];
      if (s.yMin < d.yMin) {
        d.yMin = s.yMin - yr * 0.1;
        changed = true;
      }
      if (s.yMax > d.yMax) {
        d.yMax = s.yMax + yr * 0.1;
        changed = true;
      }
    }

    if (changed) {
      d.xMin = Infinity;
      d.xMax = -Infinity;
      for (let i = 0; i < this.stores.length; i++) {
        if (!this.isVisible(i)) continue;
        if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
        const s = this.stores[i];
        if (s.xMin < d.xMin) d.xMin = s.xMin;
        if (s.xMax > d.xMax) d.xMax = s.xMax;
      }
    }
  }

  /**
   * Recompute the shared X domain from all non-empty series so grid ticks
   * and renderers always map fresh X positions. Called every draw.
   */
  private refreshXDomain(): void {
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < this.stores.length; i++) {
      if (!this.isVisible(i)) continue;
      const s = this.stores[i];
      if (s.xMin < xMin) xMin = s.xMin;
      if (s.xMax > xMax) xMax = s.xMax;
    }
    if (xMin <= xMax) {
      this.gridDomainLeft.xMin = xMin;
      this.gridDomainLeft.xMax = xMax;
      this.gridDomainRight.xMin = xMin;
      this.gridDomainRight.xMax = xMax;
    }
  }

  /** Compute the plot rectangle from canvas size minus padding. */
  private plotRect(): PlotRect {
    const [pt, pr, pb, pl] = this.opts.padding;
    return {
      x: pl,
      y: pt,
      w: this.surface.cssW - pl - pr,
      h: this.surface.cssH - pt - pb,
    };
  }

  /** Mark dirty and schedule/perform a draw per the autoDraw policy. */
  private invalidate(kind: 'layout' | 'paint' = 'layout'): void {
    if (kind === 'paint') {
      this.dirtyFrame = true;
    } else {
      this.dirtyDomain = true;
      this.dirtyFrame = true;
      this.dirtySeries = true;
    }
    if (!this.autoDraw || this.suspendCount > 0) return;
    if (this.rafScheduled) return;
    this.rafScheduled = requestAnimationFrame(() => {
      this.rafScheduled = 0;
      this.draw();
    });
  }

  private storeAt(ref: SeriesRef): SeriesStore {
    return this.stores[this.resolveRef(ref)];
  }

  /**
   * Resolve a {@link SeriesRef} to a valid 0-based index.
   * @throws {Error} if a string id is unknown or a numeric index is out of range.
   */
  private resolveRef(ref: SeriesRef): number {
    if (typeof ref === 'string') {
      const idx = this.seriesIndexById.get(ref);
      if (idx === undefined) throw new Error(`series id "${ref}" not found`);
      return idx;
    }
    if (!Number.isInteger(ref) || ref < 0 || ref >= this.stores.length) {
      throw new Error(`series index ${ref} out of range (${this.stores.length} series)`);
    }
    return ref;
  }

  /** Human-readable label for a ref, used in error messages (quotes ids). */
  private refLabel(ref: SeriesRef): string {
    return typeof ref === 'string' ? `"${ref}"` : `${ref}`;
  }

  /**
   * Recompute everything derived from {@link seriesConfigs}: the id→index map,
   * the right-axis flag, and the cached stack groups. Idempotent — called from
   * the constructor and after every structural mutation.
   * @throws {Error} if two series share the same `id`.
   */
  private rebuildSeriesDerived(): void {
    this.seriesIndexById = new Map();
    for (let i = 0; i < this.seriesConfigs.length; i++) {
      const id = this.seriesConfigs[i].id;
      if (id === undefined) continue;
      if (this.seriesIndexById.has(id)) {
        throw new Error(`duplicate series id "${id}"`);
      }
      this.seriesIndexById.set(id, i);
    }

    this.hasRightAxis = this.seriesConfigs.some((c) => c.yAxis === 'right');

    this.stackGroupsAll = this.computeAllStackGroups();
    this.stackGroupsByAxis = {
      left: this.computeStackGroupsOnAxis('left'),
      right: this.computeStackGroupsOnAxis('right'),
    };
    this.validateStackGroups();
  }

  /**
   * Whether series `i` participates in rendering, the grid domain, and the
   * crosshair. A hidden series (or one with no data) is excluded everywhere,
   * exactly as an empty series always was.
   */
  private isVisible(i: number): boolean {
    return !this.seriesConfigs[i].hidden && this.stores[i].count > 0;
  }

  /**
   * Series shown in the legend. Hidden series are omitted, but series with no
   * data remain listed so a newly configured series does not disappear before
   * its first sample arrives.
   */
  private legendConfigs(): SeriesConfig[] {
    return this.seriesConfigs.filter((c) => !c.hidden);
  }

  /**
   * Build crosshair proxy views with per-layer cumulative Y for stacked series
   * so dots (and cursorY) sit on band edges instead of raw values. Reused by
   * draw() and injectCursor().
   */
  private buildCrosshairViews(): SeriesView[] {
    const { groups: stackGroups } = this.detectAllStackGroups();

    const stackedSurrogates = new Map<number, Float64Array>();
    for (const [, grp] of stackGroups) {
      if (grp.length < 2) continue;
      const first = this.stores[grp[0]];
      const n = first.count;
      if (n === 0) continue;

      // Build cumulative Y arrays in physical layout (length = cap) so that
      // computeHits() can use the proxy's physOf() to index into yArr
      // correctly even when the ring buffer has wrapped (head != 0).
      // Accumulation mirrors renderStackedBands: simple running sum per
      // logical sample, stored at the physical slot for that sample.
      const running = new Float64Array(first.cap);

      for (const idx of grp) {
        const s = this.stores[idx];
        if (s.count !== n) continue;

        const cumulative = new Float64Array(s.cap);
        let p = s.head;
        let toWrap = s.cap - s.head;

        for (let j = 0; j < n; j++) {
          running[p] += s.yArr[p];
          cumulative[p] = running[p];

          if (--toWrap === 0) {
            p = 0;
            toWrap = s.cap;
          } else {
            p++;
          }
        }

        stackedSurrogates.set(idx, cumulative);
      }
    }

    // Fill the pool in place so the array stays stable across frames (only
    // grows on demand inside viewForCrosshair). Truncate to current series
    // count so removeSeries/setOptions doesn't leak stale slots to callers.
    if (this.viewPoolCrosshair.length > this.stores.length) {
      this.viewPoolCrosshair.length = this.stores.length;
    }
    return this.stores.map((store, i) => {
      const cfg = this.seriesConfigs[i];
      const dom = (cfg.yAxis ?? 'left') === 'right' ? this.gridDomainRight : this.gridDomainLeft;
      let viewYMin = dom.yMin;
      let viewYMax = dom.yMax;
      if (cfg.yMin != null) viewYMin = cfg.yMin;
      if (cfg.yMax != null) viewYMax = cfg.yMax;
      const accY = stackedSurrogates.get(i);
      return this.viewForCrosshair(i, store, dom.xMin, dom.xMax, viewYMin, viewYMax, accY);
    });
  }

  /**
   * Return a valid in-plot pixel-Y for the crosshair overlay — the interpolated
   * Y of the first visible series at the current cursorX. Used by injectCursor
   * so synced charts have a cursorY inside their own plot rect (avoiding the
   * Y-bounds guard in renderCrosshair). Falls back to mid-plot if no series has
   * data.
   */
  private deriveCursorYFromViews(plot: PlotRect, views: SeriesView[]): number {
    const hits = computeHits(views, this.seriesConfigs, plot, this.cursorX, this.opts.xAxis.type);
    if (hits.length > 0) return hits[0].py;
    return plot.y + plot.h / 2;
  }

  private injectCursor(xVal: number): void {
    const dom = this.gridDomainLeft;
    if (dom.xMax <= dom.xMin) return;
    const clamped = xVal < dom.xMin ? dom.xMin : xVal > dom.xMax ? dom.xMax : xVal;
    const plot = this.plotRect();
    this.cursorX = xToPx(clamped, dom, plot);
    const views = this.buildCrosshairViews();
    const y = this.deriveCursorYFromViews(plot, views);
    this.cursorY = y < plot.y ? plot.y : y > plot.y + plot.h ? plot.y + plot.h : y;
    this.showCrosshair = true;
    // v1.9.0: mark overlay dirty so composeLayers clears stale canvas pixels
    // before the crosshair is rendered — without this, synced charts display
    // ghost lines from the previous crosshair position.
    this.dirtyOverlay = true;
    this.draw();
  }

  private injectCursorLeave(): void {
    this.showCrosshair = false;
    // v1.9.0: same overlay-dirty reason as injectCursor — the visible canvas
    // needs a full recompose to clear the stale crosshair.
    this.dirtyOverlay = true;
    this.draw();
  }

  private attachEvents(): void {
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.surface.canvas);
    const canvas = this.surface.canvas;
    // Disable the browser's native scroll/zoom gestures on the canvas so our
    // own wheel-zoom and pointer-drag pan get first crack at the gesture,
    // without blocking page scroll anywhere else on the page.
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('keydown', this.handleKeyDown);
    // Passive listeners: we only need the *event*, we never preventDefault
    // on scroll/resize. `capture: true` catches scroll on any ancestor
    // (fixed containers, virtualised lists) not just the window.
    window.addEventListener('scroll', this.handleWindowLayoutShift, { passive: true, capture: true });
    window.addEventListener('resize', this.handleWindowLayoutShift, { passive: true });
  }

  private onResize(): void {
    if (this.surface.measure()) {
      this.dirtyDomain = true;
      this.dirtyFrame = true;
      this.dirtySeries = true;
      this.draw();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const rect = this.surface.clientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;

    // v1.7.0: track this pointer's latest position for pinch detection.
    // Only pointers already recorded in activePointers count — a bare
    // mouse-hover pointermove (no prior pointerdown inside the plot) skips
    // this so it doesn't interfere with the crosshair.
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { pxX, pxY });
    }

    // Two active pointers → pinch gesture. Distance drives zoom (anchored
    // at the centroid), centroid movement drives pan on top. Runs before
    // the single-pointer drag branch so we never mix pan-drag with pinch.
    if (this.activePointers.size === 2) {
      this.updatePinchState();
      // Suppress crosshair during pinch — the two fingers occlude it and
      // synced charts shouldn't chase two anchors.
      this.showCrosshair = false;
      this.scheduleInteractionFrame();
      return;
    }

    // Apply state changes synchronously so programmatic reads like
    // getViewport() reflect the latest gesture on the next line, but
    // coalesce the *repaint* into a rAF so bursts of pointermove (up to
    // 240Hz on modern touchpads) collapse to one draw per frame instead
    // of one draw per event.
    if (this.dragging) {
      const dx = pxX - this.dragLastPx;
      this.dragLastPx = pxX;
      if (dx !== 0) this.applyPan(dx);
    }
    this.cursorX = pxX;
    this.cursorY = pxY;
    this.showCrosshair = true;
    // v1.9.0: pointer moved → overlay needs to recompose. Frame + series
    // stay untouched. This is what makes crosshair move p50 < 2 ms.
    this.dirtyOverlay = true;
    this.notifySyncCrosshair();
    this.scheduleInteractionFrame();
  }

  /** Begin a pan drag when the pointer goes down inside the plot area. */
  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // primary button only
    const rect = this.surface.clientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const plot = this.plotRect();
    if (pxX < plot.x || pxX > plot.x + plot.w || pxY < plot.y || pxY > plot.y + plot.h) return;

    // v1.7.0: record every pointer that touches down inside the plot so
    // pointermove can detect a two-finger pinch. Cleared on up/cancel.
    this.activePointers.set(e.pointerId, { pxX, pxY });

    // First pointer: begin single-pointer pan drag as before. If a second
    // finger lands, onPointerMove will switch modes to pinch on the fly
    // (and pinching = true will suppress the pan branch there).
    if (this.activePointers.size === 1) {
      this.dragging = true;
      this.dragLastPx = pxX;
    } else if (this.activePointers.size === 2) {
      // Second finger — cancel any in-flight pan and initialise the pinch
      // baseline. Distance = 0 sentinel is replaced on the next move.
      this.dragging = false;
      this.pinching = true;
      this.pinchLastDist = 0;
      this.pinchLastCentroidX = 0;
    }
    try {
      this.surface.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture unavailable in some environments — pan still tracks
      // via pointermove as long as the pointer stays over the canvas.
    }
  }

  private onPointerUp(e: PointerEvent): void {
    // v1.7.0: drop the pointer from the active set even if we weren't
    // dragging (e.g. tap that never moved). If a pinch had two pointers
    // and one lifts, exit pinch mode; the remaining pointer becomes the
    // new pan anchor so a smooth pinch→pan handoff feels natural.
    const wasTracked = this.activePointers.delete(e.pointerId);
    if (this.pinching && this.activePointers.size < 2) {
      this.pinching = false;
      if (this.activePointers.size === 1) {
        this.dragging = true;
        const remaining = this.activePointers.values().next().value;
        if (remaining) this.dragLastPx = remaining.pxX;
      }
    }
    if (this.activePointers.size === 0) this.dragging = false;
    // Only release pointer capture for pointers we actually captured.
    // A stray pointerup (e.g. mouse hover release we never captured)
    // shouldn't touch the capture state at all.
    if (wasTracked) {
      try {
        this.surface.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // no-op — capture may already be released (e.g. pointercancel)
      }
    }
  }

  private onPointerLeave(): void {
    // Pointer capture keeps delivering pointermove/up outside the canvas
    // bounds during an active drag or pinch — don't hide the crosshair
    // mid-gesture.
    if (this.dragging || this.pinching) return;
    this.showCrosshair = false;
    // v1.9.0: flag overlay dirty so the visible canvas recomposes and clears
    // the stale crosshair — without this, ghost crosshair lines persist
    // after the pointer leaves.
    this.dirtyOverlay = true;
    this.draw();
    this.notifySyncCrosshairLeave();
  }

  /**
   * v1.7.0 pinch handling. Called by `onPointerMove` while exactly two
   * pointers are down. Computes the current pointer-pair distance and
   * centroid, and — starting from the second pointermove of the gesture
   * (the first is used to seed the baseline) — applies zoom + optional
   * pan proportional to how much each changed since the last frame.
   *
   * Zoom factor is `prevDist / currDist` so spreading fingers apart
   * (currDist > prevDist) shrinks the visible range (factor < 1 = zoom
   * in), anchored at the centroid so the exact data point between the two
   * fingers stays under the centroid.
   */
  private updatePinchState(): void {
    // Extract the two active pointers. Order-independent so which finger
    // moves doesn't change semantics.
    const it = this.activePointers.values();
    const a = it.next().value!;
    const b = it.next().value!;
    const dist = Math.hypot(a.pxX - b.pxX, a.pxY - b.pxY);
    const centroidX = (a.pxX + b.pxX) / 2;

    // First move in the gesture: just seed the baseline, nothing to apply
    // yet. Also guard against a zero-distance snapshot (fingers exactly
    // overlapping — no meaningful axis).
    if (this.pinchLastDist === 0 || dist === 0) {
      this.pinchLastDist = dist;
      this.pinchLastCentroidX = centroidX;
      return;
    }

    // Zoom: the ratio of distances. Applied around the centroid so the
    // data between the fingers stays pinned. Clamp per frame so a wildly
    // shaky pinch can't slam the viewport in a single event.
    let factor = this.pinchLastDist / dist;
    if (factor > 2) factor = 2;
    else if (factor < 0.5) factor = 0.5;
    if (factor !== 1) this.applyZoom(centroidX, factor);

    // Pan: how far the centroid slid. Same sign convention as drag pan
    // (positive dx = looked further left, i.e. viewport shifted left).
    const dx = centroidX - this.pinchLastCentroidX;
    if (dx !== 0) this.applyPan(dx);

    this.pinchLastDist = dist;
    this.pinchLastCentroidX = centroidX;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.surface.clientRect();
    const pxX = e.clientX - rect.left;

    // v1.7.0: normalise deltaY across input devices before deciding a zoom
    // factor. Raw deltaY is uncomparable between:
    //   - a real mouse wheel click (deltaY ≈ ±100, deltaMode=0/1, coarse)
    //   - a precision touchpad (deltaY ≈ ±3 per event, deltaMode=0, up to
    //     100 events per second → without normalisation, one swipe zooms
    //     500 % because 100 × factor 1.1 ^ 100 explodes)
    //   - a Firefox line-mode wheel (deltaY ≈ ±3, deltaMode=1=lines)
    // Convert everything to a common "pixels of scroll" scale by treating
    // one line as 16 CSS pixels and one page as 400. Then compose the zoom
    // factor exponentially so 100 px of scroll ≈ a 22 % step (comfortable
    // for both a coarse click and a smooth swipe).
    let delta = e.deltaY;
    if (e.deltaMode === 1)
      delta *= 16; // WheelEvent.DOM_DELTA_LINE
    else if (e.deltaMode === 2) delta *= 400; // WheelEvent.DOM_DELTA_PAGE

    // Clamp so a single wild event (some drivers emit deltaY = 1000+) can't
    // slam the viewport by a huge factor — the burst-coalescing rAF will
    // still compose subsequent events across the frame.
    if (delta > 500) delta = 500;
    else if (delta < -500) delta = -500;

    // exp(delta / 500) → deltaY = +100 → factor ≈ 1.22 (zoom out ~22 %);
    // deltaY = -100 → factor ≈ 0.82 (zoom in ~22 %). Preserves the sign
    // convention (positive deltaY = zoom out) used by the pre-v1.7 code
    // and the existing test suite.
    const factor = Math.exp(delta / 500);
    // v1.7.0: apply the zoom synchronously so getViewport() reflects the
    // wheel tick immediately, but let the repaint happen inside a rAF so a
    // burst of wheel events (touchpads emit 60-120 per second) folds into
    // one draw per frame.
    this.applyZoom(pxX, factor);
    this.scheduleInteractionFrame();
  }

  /**
   * Schedule a single rAF that redraws after interaction state changed.
   * Idempotent: repeated calls within the same frame reuse the pending rAF.
   * State mutations (viewport, cursor, dragging) run synchronously in the
   * handlers; this only coalesces the *repaint*.
   */
  private scheduleInteractionFrame(): void {
    if (this.destroyed || this.interactionRafId) return;
    this.interactionRafId = requestAnimationFrame(() => {
      this.interactionRafId = 0;
      if (this.destroyed) return;
      this.draw();
    });
  }
}
