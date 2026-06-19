/**
 * @file Abstract chart orchestrator shared by every chart type.
 *
 * Owns cross-cutting concerns: the data store, the canvas surface, the dirty
 * flag and rAF coalescing, pointer interaction state, the ResizeObserver, and
 * the draw sequence (static layer → offscreen, blit, crosshair overlay). All
 * data lives in {@link SeriesStore}; all pixels are produced by the `render/`
 * functions. The only thing a subclass decides is how to draw the series
 * line/fill — via {@link renderSeries}.
 *
 * Not exported; consumers receive a concrete {@link LineChart} or
 * {@link AreaChart}.
 */

import { CHART_DEFAULTS } from '../defaults.ts'
import { SeriesStore } from '../data/series-store.ts'
import { Surface } from '../render/surface.ts'
import { renderGrid, renderAxes } from '../render/axes.ts'
import { renderCrosshair } from '../render/crosshair.ts'
import type { ChartOpts, ResolvedOpts, SeriesView, PlotRect } from '../types.ts'

/** Abstract base for all chart types. */
export abstract class ChartBase {
  protected opts: ResolvedOpts
  protected surface: Surface
  protected store = new SeriesStore()

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

    if (opts?.maxPoints != null && opts.maxPoints > 0) {
      this.store.initRing(opts.maxPoints)
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

  /** Snapshot mode: replace the whole series (O(n) extent). */
  setData(x: Float64Array<ArrayBufferLike>, y: Float64Array<ArrayBufferLike>): void {
    this.store.setData(x, y)
    this.invalidate()
  }

  /** Ring mode: append one sample. Requires construction with `maxPoints`. */
  append(x: number, y: number): void {
    this.store.append(x, y)
    this.invalidate()
  }

  /** Ring mode: append a batch of parallel samples. */
  appendBatch(xs: ArrayLike<number>, ys: ArrayLike<number>): void {
    this.store.appendBatch(xs, ys)
    this.invalidate()
  }

  /** Resize the streaming window, keeping the most recent samples. */
  setMaxPoints(maxPoints: number): void {
    this.store.setMaxPoints(maxPoints)
    this.invalidate()
  }

  /** Empty the current data (works in both modes). */
  clear(): void {
    this.store.clear()
    this.invalidate()
  }

  /** Number of points currently in the window. */
  get pointCount(): number {
    return this.store.count
  }
  /** Current window y minimum (O(1)). */
  get extentMin(): number {
    return this.store.yMin
  }
  /** Current window y maximum (O(1)). */
  get extentMax(): number {
    return this.store.yMax
  }
  /** Most recent y value, or NaN if empty. */
  get lastValue(): number {
    return this.store.lastValue
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
        this.store,
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

  /** Render the static layer (background, grid, axes, series) to offscreen. */
  private renderStatic(plot: PlotRect): void {
    const ctx = this.surface.offscreenCtx()
    const { cssW, cssH } = this.surface
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.fillStyle = this.opts.bgColor
    ctx.fillRect(0, 0, cssW, cssH)

    if (this.store.count === 0) return

    renderGrid(ctx, this.store, plot, this.opts)
    renderAxes(ctx, this.store, plot, this.opts)
    this.renderSeries(ctx, this.store, plot, this.opts)
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
