/**
 * @file Streaming dashboard entry point.
 *
 * Wires the panels, metrics strip, and control bar together and runs the tick
 * loop. Each tick generates batches per-series and appends to the engine
 * (ring mode); the chart's autoDraw coalesces the burst into one rAF paint.
 * Append cost is measured per tick and surfaced in the metrics strip, so the
 * controls double as a live performance probe.
 */

import { PANELS, buildPanel, type Panel } from './panels.ts'
import { buildMetrics } from './metrics.ts'
import { fmt } from './format.ts'

const gridEl = document.getElementById('grid')!
const kpisEl = document.getElementById('kpis')!
const footerEl = document.getElementById('footer')!
const metricEls = buildMetrics(document.getElementById('metrics')!)

// ---- Controls ------------------------------------------------------------

const $ = (id: string) => document.getElementById(id) as HTMLInputElement
const intervalEl = $('interval'), intervalVal = document.getElementById('intervalVal')!
const batchEl = $('batch'), batchVal = document.getElementById('batchVal')!
const windowEl = $('window'), windowVal = document.getElementById('windowVal')!
const modeEl = $('mode')
const toggleEl = $('toggle'), resetEl = $('reset')

let intervalMs = +intervalEl.value
let batchSize = +batchEl.value
let windowSize = +windowEl.value
let mode = modeEl.value as 'interval' | 'raf'
let running = true

let tickCount = 0
let totalPoints = 0
let drawAvg = 0
let pointsThisSecond = 0

// ---- Panels --------------------------------------------------------------

const panels: Panel[] = PANELS.map((def) => buildPanel(gridEl, kpisEl, def, windowSize))

// ---- Tick: generate batch per series, append, measure --------------------

function tick(): void {
  let appendMs = 0

  for (const p of panels) {
    const reps = Math.max(1, Math.round(batchSize * p.def.batchMul))
    if (reps > p.bx.length) {
      p.bx = new Float64Array(reps)
      p.by = new Float64Array(reps)
    }
    const bx = p.bx, by = p.by

    const t0 = performance.now()

    for (let si = 0; si < p.gens.length; si++) {
      const gen = p.gens[si]
      for (let i = 0; i < reps; i++) {
        bx[i] = p.nextXs[si]
        by[i] = gen.next()
        p.nextXs[si]++
      }
      p.chart.appendBatch(si, bx.subarray(0, reps), by.subarray(0, reps))
      totalPoints += reps
      pointsThisSecond += reps
    }

    appendMs += performance.now() - t0

    const kpiSeries = p.def.kpiSeries ?? 0
    if (p.def.kpi && p.valueEl && p.rangeEl) {
      const u = p.def.kpi.unit, d = p.def.kpi.digits ?? 0
      p.valueEl.textContent = `${fmt(p.chart.lastValue(kpiSeries), d)}${u}`
      p.rangeEl.textContent = `min ${fmt(p.chart.extentMin(kpiSeries), d)}${u} · max ${fmt(p.chart.extentMax(kpiSeries), d)}${u}`
    }

    p.badgeEl.textContent = `${fmt(p.chart.pointCount(0))} pts`
  }

  tickCount++
  drawAvg = drawAvg === 0 ? appendMs : drawAvg * 0.9 + appendMs * 0.1

  metricEls.last.innerHTML = `${appendMs.toFixed(2)} <small>ms</small>`
  metricEls.avg.innerHTML = `${drawAvg.toFixed(2)} <small>ms</small>`
  metricEls.ticks.textContent = fmt(tickCount)
  metricEls.total.textContent = fmt(totalPoints)
}

// ---- Scheduler (interval or rAF) -----------------------------------------

let timerId: number | null = null
let rafId: number | null = null
let lastRaf = 0

function stopScheduler(): void {
  if (timerId !== null) { clearInterval(timerId); timerId = null }
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
}

function startScheduler(): void {
  stopScheduler()
  if (!running) return
  if (mode === 'raf') {
    lastRaf = performance.now()
    const loop = (now: number) => {
      if (!running || mode !== 'raf') return
      if (intervalMs === 0 || now - lastRaf >= intervalMs) {
        lastRaf = now
        tick()
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
  } else {
    timerId = window.setInterval(tick, Math.max(0, intervalMs))
  }
}

// ---- Points-per-second sampler (1s cadence) ------------------------------

setInterval(() => {
  metricEls.pps.textContent = fmt(pointsThisSecond)
  pointsThisSecond = 0
  footerEl.textContent =
    `${panels.length} charts · multi-series · window ${fmt(windowSize)} pts · mode: ${mode}`
}, 1000)

// ---- Control wiring ------------------------------------------------------

intervalEl.addEventListener('input', () => {
  intervalMs = +intervalEl.value
  intervalVal.textContent = `${intervalMs} ms`
  startScheduler()
})
batchEl.addEventListener('input', () => {
  batchSize = +batchEl.value
  batchVal.textContent = String(batchSize)
})
windowEl.addEventListener('input', () => {
  windowSize = +windowEl.value
  windowVal.textContent = fmt(windowSize)
  for (const p of panels) {
    p.chart.setMaxPoints(Math.max(2, Math.round(windowSize * p.def.windowMul)))
  }
})
modeEl.addEventListener('change', () => {
  mode = modeEl.value as 'interval' | 'raf'
  startScheduler()
})
toggleEl.addEventListener('click', () => {
  running = !running
  toggleEl.textContent = running ? 'Pause' : 'Start'
  toggleEl.classList.toggle('primary', running)
  startScheduler()
})
resetEl.addEventListener('click', () => {
  for (const p of panels) {
    p.chart.clear()
    p.gens = p.def.series.map((s) => s.gen())
    p.nextXs = p.def.series.map(() => 0)
  }
  tickCount = 0
  totalPoints = 0
  drawAvg = 0
  pointsThisSecond = 0
  metricEls.total.textContent = '0'
  metricEls.ticks.textContent = '0'
})

// ---- Go ------------------------------------------------------------------

intervalVal.textContent = `${intervalMs} ms`
batchVal.textContent = String(batchSize)
windowVal.textContent = fmt(windowSize)

tick()
startScheduler()
