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
 */

import { CHART_DEFAULTS } from '../defaults.ts'
import { SeriesStore } from '../data/series-store.ts'
import { Surface } from '../render/surface.ts'
import { renderGrid, renderAxes } from '../render/axes.ts'
import { renderCrosshair } from '../render/crosshair.ts'
import { renderLegend } from '../render/legend.ts'
import type { ChartOpts, ResolvedOpts, SeriesConfig, SeriesView, PlotRect } from '../types.ts'

/** Abstract base for all chart types. */
export abstract class ChartBase {
  protected opts: ResolvedOpts
  protected surface: Surface
  protected stores: SeriesStore[]
  protected seriesConfigs: SeriesConfig[]

  private gridDomain = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 }
  private gridPinned = false

  private dirty = false
  private cursorX = -1
  private cursorY = -1
  private showCrosshair = false

  private autoDraw: boolean
  private rafScheduled = 0

  private resizeObserver: ResizeObserver | null = null
  private readonly handleResize = () => this.onResize()
  private readonly handleMouseMove = (e: MouseEvent) => this.onMouseMove(e)
  private readonly handleMouseLeave = () => this.onMouseLeave()

  constructor(canvas: HTMLCanvasElement, opts?: ChartOpts) {
    this.opts = { ...CHART_DEFAULTS, ...opts }
    this.autoDraw = this.opts.autoDraw
    this.surface = new Surface(canvas)

    this.seriesConfigs = this.opts.series.length > 0
      ? this.opts.series
      : [{ name: 'Series 0', color: this.opts.lineColor }]

    this.stores = this.seriesConfigs.map(() => new SeriesStore())

    if (opts?.maxPoints != null && opts.maxPoints > 0) {
      for (const s of this.stores) s.initRing(opts.maxPoints)
    }

    this.dirty = true
    this.attachEvents()
  }

  /** Draw the series shape. Implemented by {@link LineChart} / {@link AreaChart}. */
  protected abstract renderSeries(
    ctx: CanvasRenderingContext2D,
    view: SeriesView,
    plot: PlotRect,
    opts: ResolvedOpts,
  ): void

  // ---- Public data API -----------------------------------------------------

  /** Snapshot mode: replace the series at `index` (O(n) extent). */
  setData(index: number, x: Float64Array<ArrayBufferLike>, y: Float64Array<ArrayBufferLike>): void {
    this.storeAt(index).setData(x, y)
    this.gridPinned = false
    this.invalidate()
  }

  /** Ring mode: append one sample to series `index`. */
  append(index: number, x: number, y: number): void {
    this.storeAt(index).append(x, y)
    this.invalidate()
  }

  /** Ring mode: append a batch of samples to series `index`. */
  appendBatch(index: number, xs: ArrayLike<number>, ys: ArrayLike<number>): void {
    this.storeAt(index).appendBatch(xs, ys)
    this.invalidate()
  }

  /** Resize the streaming window (applies to all series). */
  setMaxPoints(maxPoints: number): void {
    for (const s of this.stores) s.setMaxPoints(maxPoints)
    this.invalidate()
  }

  /** Empty all series. */
  clear(): void {
    for (const s of this.stores) s.clear()
    this.gridPinned = false
    this.invalidate()
  }

  /** Number of series configured. */
  get seriesCount(): number {
    return this.stores.length
  }

  /** Number of points currently in the window for series `index`. */
  pointCount(index: number): number {
    return this.stores[index].count
  }
  /** Current window y minimum for series `index` (O(1)). */
  extentMin(index: number): number {
    return this.stores[index].yMin
  }
  /** Current window y maximum for series `index` (O(1)). */
  extentMax(index: number): number {
    return this.stores[index].yMax
  }
  /** Most recent y value for series `index`, or NaN if empty. */
  lastValue(index: number): number {
    return this.stores[index].lastValue
  }

  // ---- Rendering -----------------------------------------------------------

  /** Paint the chart. Cheap to call repeatedly: returns early when clean. */
  draw(): void {
    if (!this.dirty && !this.showCrosshair) return
    const { cssW, cssH } = this.surface
    if (cssW <= 0 || cssH <= 0) return

    const plot = this.plotRect()
    if (plot.w <= 0 || plot.h <= 0) return

    if (this.dirty) {
      this.renderStatic(plot)
    }

    this.surface.blit()

    if (this.showCrosshair) {
      renderCrosshair(
        this.surface.ctx,
        this.stores,
        this.seriesConfigs,
        plot,
        this.opts,
        { x: this.cursorX, y: this.cursorY },
        cssW,
      )
    }

    this.dirty = false
  }

  /** Detach observers/listeners and release buffers. */
  destroy(): void {
    if (this.rafScheduled) {
      cancelAnimationFrame(this.rafScheduled)
      this.rafScheduled = 0
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.surface.canvas.removeEventListener('mousemove', this.handleMouseMove)
    this.surface.canvas.removeEventListener('mouseleave', this.handleMouseLeave)
    this.surface.dispose()
  }

  // ---- Internals -----------------------------------------------------------

  /** Render the static layer (background, grid, axes, series, legend) to offscreen. */
  private renderStatic(plot: PlotRect): void {
    const ctx = this.surface.offscreenCtx()
    const { cssW, cssH } = this.surface
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.fillStyle = this.opts.bgColor
    ctx.fillRect(0, 0, cssW, cssH)

    if (this.stores.every((s) => s.count === 0)) return

    this.updateGridDomain()

    renderGrid(ctx, this.gridDomain, plot, this.opts)
    renderAxes(ctx, this.gridDomain, plot, this.opts)

    // Render each series with its own colour/style override.
    for (let i = 0; i < this.stores.length; i++) {
      const store = this.stores[i]
      if (store.count === 0) continue
      const cfg = this.seriesConfigs[i]
      const sOpts: ResolvedOpts = {
        ...this.opts,
        lineColor: cfg.color,
        lineWidth: cfg.lineWidth ?? this.opts.lineWidth,
        fillColor: cfg.fillColor ?? this.opts.fillColor,
        fillOpacity: cfg.fillOpacity ?? this.opts.fillOpacity,
      }
      this.renderSeries(ctx, store, plot, sOpts)
    }

    renderLegend(ctx, this.seriesConfigs, plot, this.opts)
  }

  /**
   * Anchor the grid so it only expands, never shrinks.
   *
   * On the first call after data arrives the grid domain snaps to the union
   * extent across all series. Afterwards it stays frozen until any series
   * exceeds it, at which point it expands with a 10 % margin on the breached
   * side. This keeps the horizontal reference lines stationary so the eye
   * tracks movement within a stable frame.
   */
  private updateGridDomain(): void {
    const d = this.gridDomain
    if (this.stores.every((s) => s.count === 0)) return

    if (!this.gridPinned) {
      d.xMin = Infinity
      d.xMax = -Infinity
      d.yMin = Infinity
      d.yMax = -Infinity
      for (const s of this.stores) {
        if (s.count === 0) continue
        if (s.xMin < d.xMin) d.xMin = s.xMin
        if (s.xMax > d.xMax) d.xMax = s.xMax
        if (s.yMin < d.yMin) d.yMin = s.yMin
        if (s.yMax > d.yMax) d.yMax = s.yMax
      }
      this.gridPinned = true
      return
    }

    let changed = false
    const yr = d.yMax - d.yMin || 1
    for (const s of this.stores) {
      if (s.count === 0) continue
      if (s.yMin < d.yMin) { d.yMin = s.yMin - yr * 0.1; changed = true }
      if (s.yMax > d.yMax) { d.yMax = s.yMax + yr * 0.1; changed = true }
    }
    if (changed) {
      d.xMin = Infinity
      d.xMax = -Infinity
      for (const s of this.stores) {
        if (s.count === 0) continue
        if (s.xMin < d.xMin) d.xMin = s.xMin
        if (s.xMax > d.xMax) d.xMax = s.xMax
      }
    }
  }

  /** Compute the plot rectangle from canvas size minus padding. */
  private plotRect(): PlotRect {
    const [pt, pr, pb, pl] = this.opts.padding
    return {
      x: pl,
      y: pt,
      w: this.surface.cssW - pl - pr,
      h: this.surface.cssH - pt - pb,
    }
  }

  /** Mark dirty and schedule/perform a draw per the autoDraw policy. */
  private invalidate(): void {
    this.dirty = true
    if (!this.autoDraw) return
    if (this.rafScheduled) return
    this.rafScheduled = requestAnimationFrame(() => {
      this.rafScheduled = 0
      this.draw()
    })
  }

  private storeAt(index: number): SeriesStore {
    const s = this.stores[index]
    if (!s) throw new Error(`series index ${index} out of range (${this.stores.length} series)`)
    return s
  }

  private attachEvents(): void {
    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(this.surface.canvas)
    this.surface.canvas.addEventListener('mousemove', this.handleMouseMove)
    this.surface.canvas.addEventListener('mouseleave', this.handleMouseLeave)
  }

  private onResize(): void {
    if (this.surface.measure()) {
      this.dirty = true
      this.draw()
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const rect = this.surface.canvas.getBoundingClientRect()
    this.cursorX = e.clientX - rect.left
    this.cursorY = e.clientY - rect.top
    this.showCrosshair = true
    this.draw()
  }

  private onMouseLeave(): void {
    this.showCrosshair = false
    this.draw()
  }
}
