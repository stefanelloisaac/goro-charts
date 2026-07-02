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
import type { ChartOpts, ResolvedOpts, SeriesConfig, SeriesView, PlotRect, Domain } from '../types.ts';
import type { SeriesHit } from '../render/crosshair.ts';

/** Abstract base for all chart types. */
export abstract class ChartBase {
  protected opts: ResolvedOpts;
  protected surface: Surface;
  protected stores: SeriesStore[];
  protected seriesConfigs: SeriesConfig[];

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

  private dirty = false;
  private cursorX = -1;
  private cursorY = -1;
  private showCrosshair = false;

  private autoDraw: boolean;
  private rafScheduled = 0;
  private suspendCount = 0;
  private syncTargets = new Set<ChartBase>();

  private resizeObserver: ResizeObserver | null = null;
  protected destroyed = false;
  private liveRegion: HTMLElement | null = null;
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
    this.hasRightAxis = this.seriesConfigs.some((c) => c.yAxis === 'right');

    // Detect stack groups once — seriesConfigs is frozen from here on.
    this.stackGroupsAll = this.computeAllStackGroups();
    this.stackGroupsByAxis = {
      left: this.computeStackGroupsOnAxis('left'),
      right: this.computeStackGroupsOnAxis('right'),
    };

    if (opts?.maxPoints != null && opts.maxPoints > 0) {
      for (const s of this.stores) s.initRing(opts.maxPoints);
    }

    if (this.opts.yMin !== 0 || this.opts.yMax !== 0) {
      this.gridDomainLeft.yMin = this.opts.yMin;
      this.gridDomainLeft.yMax = this.opts.yMax;
      this.gridDomainRight.yMin = this.opts.yMin;
      this.gridDomainRight.yMax = this.opts.yMax;
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
    if (this.opts.yMin > 0 && this.opts.yMax > 0 && this.opts.yMin >= this.opts.yMax) {
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
   * - prefers-reduced-motion → disable rAF coalescing (synchronous draws)
   * - prefers-contrast: more → increase colour opacity
   * - forced-colors: active → use system CSS system colours
   */
  private applySystemTheme(): void {
    try {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (reducedMotion.matches) this.autoDraw = false;

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
      this.liveRegion.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;';
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
      .map((s, i) => ({ config: this.seriesConfigs[i], count: s.count, last: s.lastValue }))
      .filter((s) => s.count > 0);

    let label: string;
    if (nonEmpty.length === 0) {
      label = 'Chart: no data';
    } else {
      label = `Chart: ${nonEmpty
        .map((s) => `${s.config.name} ${formatNumber(s.last)}`)
        .join(', ')}`;
    }
    this.surface.canvas.setAttribute('aria-label', label);
  }

  /**
   * Handle keyboard navigation for the crosshair.
   * - ArrowLeft / ArrowRight: move crosshair by 1 point (Shift: 10 points)
   * - Escape: hide crosshair
   */
  private onKeyDown(e: KeyboardEvent): void {
    if (document.activeElement !== this.surface.canvas) return;

    const step = e.shiftKey ? 10 : 1;
    const plot = this.plotRect();

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.cursorX = Math.max(plot.x, this.cursorX - step);
        this.showCrosshair = true;
        this.draw();
        this.notifySyncCrosshair();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.cursorX = Math.min(plot.x + plot.w, this.cursorX + step);
        this.showCrosshair = true;
        this.draw();
        this.notifySyncCrosshair();
        break;
      case 'Escape':
        e.preventDefault();
        this.showCrosshair = false;
        this.draw();
        this.notifySyncCrosshairLeave();
        break;
    }
  }

  /** Reusable crosshair-sync helpers used by both mouse and keyboard handlers. */
  private notifySyncCrosshair(): void {
    const rect = this.surface.canvas.getBoundingClientRect();
    const clientX = rect.left + this.cursorX;
    for (const target of this.syncTargets) target.injectCursor(clientX);
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
   * Snapshot mode: replace the series at `index` (O(n) extent).
   * @param index - Series index (0-based)
   * @param x - X values, must be monotonically increasing
   * @param y - Y values, must have the same length as x
   * @throws {Error} if `index` is out of range, or x/y length mismatch
   */
  setData(index: number, x: Float64Array<ArrayBufferLike>, y: Float64Array<ArrayBufferLike>): void {
    if (this.destroyed) return;
    this.storeAt(index).setData(x, y);
    this.gridPinned = false;
    this.invalidate();
  }

  /**
   * Ring mode: append one sample to series `index`.
   * @param index - Series index (0-based)
   * @param x - X value (must be monotonically increasing)
   * @param y - Y value
   * @throws {Error} if ring mode is not active (maxPoints not set)
   * @throws {Error} if `index` is out of range
   */
  append(index: number, x: number, y: number): void {
    if (this.destroyed) return;
    this.storeAt(index).append(x, y);
    this.invalidate();
  }

  /**
   * Ring mode: append a batch of samples to series `index`.
   * @param index - Series index (0-based)
   * @param xs - X values (must be monotonically increasing)
   * @param ys - Y values, must have the same length as xs
   * @throws {Error} if ring mode is not active
   * @throws {Error} if `index` is out of range or xs/ys length mismatch
   */
  appendBatch(index: number, xs: ArrayLike<number>, ys: ArrayLike<number>): void {
    if (this.destroyed) return;
    this.storeAt(index).appendBatch(xs, ys);
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
    this.invalidate();
  }

  /** Number of series configured. */
  get seriesCount(): number {
    if (this.destroyed) return 0;
    return this.stores.length;
  }

  /**
   * Total points rendered across all series in the last draw.
   * Useful for debug/performance monitoring (e.g. to verify decimation is active).
   */
  get renderedPointCount(): number {
    if (this.destroyed) return 0;
    return this.stores.reduce((sum, s) => sum + s.count, 0);
  }

  /**
   * Number of points currently in the window for series `index`.
   * @param index - Series index (0-based)
   */
  pointCount(index: number): number {
    if (this.destroyed) return 0;
    return this.stores[index].count;
  }
  /**
   * Current window y minimum for series `index` (O(1)).
   * @param index - Series index (0-based)
   */
  extentMin(index: number): number {
    if (this.destroyed) return NaN;
    return this.stores[index].yMin;
  }
  /**
   * Current window y maximum for series `index` (O(1)).
   * @param index - Series index (0-based)
   */
  extentMax(index: number): number {
    if (this.destroyed) return NaN;
    return this.stores[index].yMax;
  }
  /**
   * Most recent y value for series `index`, or NaN if empty.
   * @param index - Series index (0-based)
   */
  lastValue(index: number): number {
    if (this.destroyed) return NaN;
    return this.stores[index].lastValue;
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
    if (!this.dirty && !this.showCrosshair) return;
    const { cssW, cssH } = this.surface;
    if (cssW <= 0 || cssH <= 0) return;

    const plot = this.plotRect();
    if (plot.w <= 0 || plot.h <= 0) return;

    if (this.dirty) {
      this.renderStatic(plot);
      this.updateAriaLabel();
    }

    this.surface.blit();

    if (this.showCrosshair) {
      // Detect stacked groups so we can use accumulated Y (matching the band
      // edges) for crosshair dot positions.
      const { groups: stackGroups } = this.detectAllStackGroups();

      // Pre-compute accumulated crosshair views — for stacked series we
      // replace yArr with the cumulative Y so dots sit on band edges.
      const stackedSurrogates = new Map<number, Float64Array>();
      for (const [, grp] of stackGroups) {
        if (grp.length < 2) continue;
        const cum = this.accumulateStackGroup(grp);
        if (!cum) continue;
        for (const idx of grp) {
          stackedSurrogates.set(idx, new Float64Array(cum));
        }
      }

      const crosshairViews: SeriesView[] = this.stores.map((store, i) => {
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

      if (this.onHover || this.liveRegion) {
        const hits = computeHits(crosshairViews, this.seriesConfigs, plot, this.cursorX);
        if (this.onHover && hits.length > 0) this.onHover(hits);
        if (this.liveRegion) {
          this.liveRegion.textContent = hits.length > 0
            ? hits.map((h) => `${h.label}: ${formatNumber(h.yVal)}`).join(', ')
            : '';
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
    this.surface.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.surface.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.surface.canvas.removeEventListener('keydown', this.handleKeyDown);
    this.liveRegion?.remove();
    this.liveRegion = null;
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

    if (this.stores.every((s) => s.count === 0)) return;

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
      const store = this.stores[i];
      if (store.count === 0) continue;
      this.renderOne(ctx, i, store, store.yArr, plot);
    }

    // Stacked groups: build stores + styles arrays, delegate to band renderer.
    for (const [, grp] of stackGroups) {
      if (grp.length < 2) {
        for (const idx of grp) {
          const s = this.stores[idx];
          if (s.count > 0) this.renderOne(ctx, idx, s, s.yArr, plot);
        }
        continue;
      }
      const bandStores: SeriesView[] = [];
      const bandStyles: { lineColor: string; lineWidth: number; fillColor: string; fillOpacity: number }[] = [];
      for (const idx of grp) {
        const s = this.stores[idx];
        if (s.count === 0) continue;
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

    renderLegend(ctx, this.seriesConfigs, plot, this.opts);
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
  private detectStackGroupsOnAxis(
    axis: 'left' | 'right',
  ): { groups: Map<string, number[]>; stacked: Set<number> } {
    return this.stackGroupsByAxis[axis];
  }

  /**
   * Compute stack groups for a given axis. Returns the group map and a set
   * of series indices that belong to groups with 2+ members.
   */
  private computeStackGroupsOnAxis(
    axis: 'left' | 'right',
  ): { groups: Map<string, number[]>; stacked: Set<number> } {
    const groups = new Map<string, number[]>();
    const stacked = new Set<number>();
    for (let i = 0; i < this.stores.length; i++) {
      if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
      const g = this.seriesConfigs[i].stack;
      if (g) {
        let grp = groups.get(g);
        if (!grp) { grp = []; groups.set(g, grp); }
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
        if (!grp) { grp = []; groups.set(g, grp); }
        grp.push(i);
      }
    }
    for (const grp of groups.values()) {
      if (grp.length >= 2) for (const idx of grp) stacked.add(idx);
    }
    return { groups, stacked };
  }

  /**
   * Compute accumulated Y values across a stack group.
   * Returns the cumulative Y array (length = n), or null if all stores are empty.
   */
  private accumulateStackGroup(indices: number[]): Float64Array | null {
    const first = this.stores[indices[0]];
    const n = first.count;
    if (n === 0) return null;
    const running = new Float64Array(n);
    for (const idx of indices) {
      const s = this.stores[idx];
      let p = s.head;
      let toWrap = s.cap - s.head;
      for (let j = 0; j < n; j++) {
        running[j] += s.yArr[p];
        if (--toWrap === 0) { p = 0; toWrap = s.cap; }
        else p++;
      }
    }
    return running;
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
    if (this.stores.every((s) => s.count === 0)) return;

    const userYMin = this.opts.yMin;
    const userYMax = this.opts.yMax;
    const fixedY = userYMin !== 0 || userYMax !== 0;
    const streaming = this.stores.some((s) => s.isRing);

    const applyUserBounds = () => {
      if (!fixedY) return;
      if (userYMin !== 0) {
        this.gridDomainLeft.yMin = userYMin;
        this.gridDomainRight.yMin = userYMin;
      }
      if (userYMax !== 0) {
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
      const cum = this.accumulateStackGroup(grp);
      if (!cum) continue;
      let yMin = Infinity;
      let yMax = -Infinity;
      // Also collect x extents from the group
      for (const idx of grp) {
        const s = this.stores[idx];
        if (s.xMin < d.xMin) d.xMin = s.xMin;
        if (s.xMax > d.xMax) d.xMax = s.xMax;
      }
      for (let j = 0; j < cum.length; j++) {
        if (cum[j] < yMin) yMin = cum[j];
        if (cum[j] > yMax) yMax = cum[j];
      }
      if (yMin < d.yMin) d.yMin = yMin;
      if (yMax > d.yMax) d.yMax = yMax;
    }

    // Non-stacked series on this axis.
    for (let i = 0; i < this.stores.length; i++) {
      if (stacked.has(i)) continue;
      const s = this.stores[i];
      if (s.count === 0) continue;
      if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
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
      const cum = this.accumulateStackGroup(grp);
      if (!cum) continue;
      let accMin = Infinity;
      let accMax = -Infinity;
      for (let j = 0; j < cum.length; j++) {
        if (cum[j] < accMin) accMin = cum[j];
        if (cum[j] > accMax) accMax = cum[j];
      }
      if (accMin < d.yMin) { d.yMin = accMin - yr * 0.1; changed = true; }
      if (accMax > d.yMax) { d.yMax = accMax + yr * 0.1; changed = true; }
    }

    // Non-stacked series on this axis.
    for (let i = 0; i < this.stores.length; i++) {
      if (stacked.has(i)) continue;
      const s = this.stores[i];
      if (s.count === 0) continue;
      if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
      if (s.yMin < d.yMin) { d.yMin = s.yMin - yr * 0.1; changed = true; }
      if (s.yMax > d.yMax) { d.yMax = s.yMax + yr * 0.1; changed = true; }
    }

    if (changed) {
      d.xMin = Infinity;
      d.xMax = -Infinity;
      for (let i = 0; i < this.stores.length; i++) {
        const s = this.stores[i];
        if (s.count === 0) continue;
        if ((this.seriesConfigs[i].yAxis ?? 'left') !== axis) continue;
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
    for (const s of this.stores) {
      if (s.count === 0) continue;
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

  private storeAt(index: number): SeriesStore {
    const s = this.stores[index];
    if (!s) throw new Error(`series index ${index} out of range (${this.stores.length} series)`);
    return s;
  }

  private injectCursor(clientX: number): void {
    const rect = this.surface.canvas.getBoundingClientRect();
    this.cursorX = clientX - rect.left;
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
