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
} from '../types.ts';
import type { SeriesHit } from '../render/crosshair.ts';

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

  private dirty = false;
  private cursorX = -1;
  private cursorY = -1;
  private showCrosshair = false;

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
  private readonly handleMouseMove = (e: MouseEvent) => this.onMouseMove(e);
  private readonly handleMouseLeave = () => this.onMouseLeave();
  private readonly handleKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);

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
    }

    if (this.opts.yMin !== undefined || this.opts.yMax !== undefined) {
      if (this.opts.yMin !== undefined) this.gridDomainLeft.yMin = this.opts.yMin;
      if (this.opts.yMax !== undefined) this.gridDomainLeft.yMax = this.opts.yMax;
      if (this.opts.yMin !== undefined) this.gridDomainRight.yMin = this.opts.yMin;
      if (this.opts.yMax !== undefined) this.gridDomainRight.yMax = this.opts.yMax;
      this.gridPinned = true;
    }

    this.dirty = true;
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
    this.cursorX = xToPx(xVal, axis, plot);
    this.showCrosshair = true;
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
    const xVal = pxToX(this.cursorX, this.gridDomainLeft, plot);
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
    try {
      this.storeAt(ref).setData(x, y, ownership);
    } catch (e) {
      throw new Error(`series ${this.refLabel(ref)}: ${(e as Error).message}`, { cause: e });
    }
    this.gridPinned = false;
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
    this.invalidate();
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
    this.invalidate();
  }

  /**
   * Resize the streaming window (applies to all series).
   * Preserves the most recent samples in each series.
   * @param maxPoints - New window size (must be >= 1)
   */
  setMaxPoints(maxPoints: number): void {
    if (this.destroyed) return;
    for (const s of this.stores) s.setMaxPoints(maxPoints);
    this.invalidate();
  }

  /** Empty all series and reset grid domain. */
  clear(): void {
    if (this.destroyed) return;
    for (const s of this.stores) s.clear();
    this.gridPinned = false;
    this.stackWarned.clear();
    this.invalidate();
  }

  // ---- Runtime options & series management ---------------------------------

  /**
   * Set of top-level option keys whose change requires recomputing layout /
   * domain (as opposed to a purely visual repaint). Passing `series` is always
   * treated as structural.
   */
  private static readonly STRUCTURAL_OPTION_KEYS = new Set<keyof ChartOpts>([
    'series',
    'padding',
    'yMin',
    'yMax',
    'maxPoints',
  ]);

  /**
   * Update chart options at runtime without recreating the chart.
   *
   * Visual-only changes (colours, font, crosshair style, tick counts) repaint
   * without touching the grid domain. Structural changes (`series`, `padding`,
   * `yMin`/`yMax`, `maxPoints`) recompute the derived caches and re-anchor the
   * grid so the layout reflows.
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
    this.invalidate();
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
    if (this.suspendCount === 0 && this.dirty) this.invalidate();
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

  /**
   * External callback for hover events. Called on `mousemove` with the
   * interpolated data for every visible series. Use to build custom DOM
   * tooltips or bind to framework state — the Canvas tooltip still draws
   * unless suppressed externally.
   */
  onHover?: (hits: SeriesHit[]) => void;

  // ---- Rendering -----------------------------------------------------------

  /** Paint the chart. Cheap to call repeatedly: returns early when clean. */
  draw(): void {
    if (this.destroyed) return;
    // Nothing to paint and no stale crosshair to clean — bail early.
    if (!this.dirty && !this.showCrosshair && !this.crosshairPainted) return;
    const { cssW, cssH } = this.surface;
    if (cssW <= 0 || cssH <= 0) return;

    const plot = this.plotRect();
    if (plot.w <= 0 || plot.h <= 0) return;

    // Crosshair was hidden outside a streaming tick — re-blit the static
    // layer to clear the stale overlay immediately.
    if (!this.dirty && !this.showCrosshair && this.crosshairPainted) {
      this.surface.blit();
      this.crosshairPainted = false;
      if (this.onHover) this.onHover([]);
      return;
    }

    if (this.dirty) {
      this.renderStatic(plot);
      this.updateAriaLabel();
    }

    this.surface.blit();

    if (this.showCrosshair) {
      const crosshairViews = this.buildCrosshairViews();

      if (this.onHover || this.liveRegion) {
        const hits = computeHits(crosshairViews, this.seriesConfigs, plot, this.cursorX);
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
        cssW,
      );
    }

    if (!this.showCrosshair && this.liveRegion) {
      this.liveRegion.textContent = '';
    }

    this.dirty = false;
    this.crosshairPainted = this.showCrosshair;
  }

  /** Detach observers/listeners and release buffers. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafScheduled) {
      cancelAnimationFrame(this.rafScheduled);
      this.rafScheduled = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.reducedMotionMql?.removeEventListener('change', this.handleReducedMotionChange);
    this.reducedMotionMql = null;
    this.surface.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.surface.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.surface.canvas.removeEventListener('keydown', this.handleKeyDown);
    this.liveRegion?.remove();
    this.liveRegion = null;
    // Remove this chart from every peer's sync set to avoid dangling refs.
    for (const target of this.syncTargets) target.syncTargets.delete(this);
    this.syncTargets.clear();
    this.surface.dispose();
    this.stores = [];
  }

  // ---- Internals -----------------------------------------------------------

  /** Render the static layer (background, grid, axes, series, legend) to offscreen. */
  private renderStatic(plot: PlotRect): void {
    const ctx = this.surface.offscreenCtx();
    const { cssW, cssH } = this.surface;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = this.opts.bgColor;
    ctx.fillRect(0, 0, cssW, cssH);

    if (this.stores.every((_, i) => !this.isVisible(i))) return;

    this.updateGridDomain();

    renderGrid(ctx, this.gridDomainLeft, plot, this.opts);
    renderAxes(ctx, this.gridDomainLeft, plot, this.opts);
    if (this.hasRightAxis) {
      renderAxes(ctx, this.gridDomainRight, plot, this.opts, 'right');
    }

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

    renderLegend(ctx, this.legendConfigs(), plot, this.opts);
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
    };

    if (cfg.dash) ctx.setLineDash(cfg.dash);

    const dom = (cfg.yAxis ?? 'left') === 'right' ? this.gridDomainRight : this.gridDomainLeft;
    let viewYMin = dom.yMin;
    let viewYMax = dom.yMax;
    if (cfg.yMin != null) viewYMin = cfg.yMin;
    if (cfg.yMax != null) viewYMax = cfg.yMax;

    const proxyView: SeriesView = Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
      xMin: dom.xMin,
      xMax: dom.xMax,
      yArr,
      yMin: viewYMin,
      yMax: viewYMax,
    });

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
  private invalidate(): void {
    this.dirty = true;
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

    return this.stores.map((store, i) => {
      const cfg = this.seriesConfigs[i];
      const dom = (cfg.yAxis ?? 'left') === 'right' ? this.gridDomainRight : this.gridDomainLeft;
      let viewYMin = dom.yMin;
      let viewYMax = dom.yMax;
      if (cfg.yMin != null) viewYMin = cfg.yMin;
      if (cfg.yMax != null) viewYMax = cfg.yMax;
      const accY = stackedSurrogates.get(i);
      return Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
        xMin: dom.xMin,
        xMax: dom.xMax,
        yMin: viewYMin,
        yMax: viewYMax,
        ...(accY ? { yArr: accY } : {}),
      });
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
    const hits = computeHits(views, this.seriesConfigs, plot, this.cursorX);
    if (hits.length > 0) return hits[0].py;
    return plot.y + plot.h / 2;
  }

  private injectCursor(xVal: number): void {
    const dom = this.gridDomainLeft;
    if (dom.xMax <= dom.xMin) return; // domain not yet initialised
    // Clamp to the chart's own X domain so the synced crosshair sticks to the
    // nearest edge instead of disappearing when the two charts' domains are
    // misaligned by a single tick (common during streaming with autoDraw).
    const clamped = xVal < dom.xMin ? dom.xMin : xVal > dom.xMax ? dom.xMax : xVal;
    const plot = this.plotRect();
    this.cursorX = xToPx(clamped, dom, plot);
    const views = this.buildCrosshairViews();
    const y = this.deriveCursorYFromViews(plot, views);
    this.cursorY = y < plot.y ? plot.y : y > plot.y + plot.h ? plot.y + plot.h : y;
    this.showCrosshair = true;
    this.draw();
  }

  private injectCursorLeave(): void {
    this.showCrosshair = false;
    this.draw();
  }

  private attachEvents(): void {
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.surface.canvas);
    this.surface.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.surface.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.surface.canvas.addEventListener('keydown', this.handleKeyDown);
  }

  private onResize(): void {
    if (this.surface.measure()) {
      this.dirty = true;
      this.draw();
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const rect = this.surface.canvas.getBoundingClientRect();
    this.cursorX = e.clientX - rect.left;
    this.cursorY = e.clientY - rect.top;
    this.showCrosshair = true;
    this.draw();
    this.notifySyncCrosshair();
  }

  private onMouseLeave(): void {
    this.showCrosshair = false;
    this.draw();
    this.notifySyncCrosshairLeave();
  }
}
