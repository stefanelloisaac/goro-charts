/**
 * @file Panel definitions and DOM/chart construction for the demo.
 *
 * Two live panels in a 2-column grid, each with multiple series:
 *   - CPU Load: {@link LineChart} with CPU (random walk) + Temp (slow sine)
 *   - Requests/sec: {@link AreaChart} with Req/s (area fill) + Baseline (line)
 */

import { LineChart, AreaChart } from '../src/index.ts'
import {
  randomWalkGen,
  slowSineGen,
  noisySineGen,
  type Generator,
} from './generators.ts'
import type { SeriesConfig } from '../src/types.ts'

/** Per-series config with attached generator. */
interface SeriesDef {
  config: SeriesConfig
  gen: () => Generator
}

/** Static configuration for one panel. */
export interface PanelDef {
  id: string
  title: string
  chartType: 'line' | 'area'
  series: SeriesDef[]
  /** Window size multiplier relative to the global window. */
  windowMul: number
  /** Batch size multiplier relative to the global points/tick. */
  batchMul: number
  /** Series index used for the KPI card (default 0). */
  kpiSeries?: number
  kpi?: { label: string; unit: string; digits?: number }
}

/** Live runtime state for one panel. */
export interface Panel {
  def: PanelDef
  chart: LineChart | AreaChart
  gens: Generator[]
  nextXs: number[]
  bx: Float64Array
  by: Float64Array
  valueEl?: HTMLElement
  rangeEl?: HTMLElement
  badgeEl: HTMLElement
}

/** The dashboard's panels, in render order. */
export const PANELS: PanelDef[] = [
  {
    id: 'cpu', title: 'CPU Load', chartType: 'line', windowMul: 1, batchMul: 1,
    series: [
      { config: { name: 'CPU', color: '#4ea8ff' }, gen: () => randomWalkGen() },
      { config: { name: 'Temp', color: '#ffb454' }, gen: () => slowSineGen() },
    ],
    kpi: { label: 'CPU', unit: '%' },
  },
  {
    id: 'req', title: 'Requests / sec', chartType: 'area', windowMul: 1, batchMul: 1,
    series: [
      { config: { name: 'Req/s', color: '#52d4a0', fillColor: '#52d4a0', fillOpacity: 0.08 }, gen: () => noisySineGen() },
      { config: { name: 'Baseline', color: '#c792ff', lineWidth: 1 }, gen: () => slowSineGen(3000, 800, 600) },
    ],
    kpi: { label: 'Req/s', unit: '' },
  },
]

function buildKpi(host: HTMLElement, def: PanelDef): { value: HTMLElement; range: HTMLElement } {
  const card = document.createElement('div')
  card.className = 'kpi'
  card.innerHTML = `<div class="label">${def.kpi!.label}</div><div class="value">—</div><div class="range">—</div>`
  host.appendChild(card)
  return {
    value: card.querySelector('.value') as HTMLElement,
    range: card.querySelector('.range') as HTMLElement,
  }
}

/** Build one panel's DOM + chart and return its runtime state. */
export function buildPanel(
  gridHost: HTMLElement,
  kpiHost: HTMLElement,
  def: PanelDef,
  windowSize: number,
): Panel {
  const el = document.createElement('div')
  el.className = 'panel'
  el.innerHTML = `
    <div class="head">
      <span class="title">${def.title}</span>
      <span class="badge">—</span>
    </div>
    <canvas></canvas>`
  gridHost.appendChild(el)

  const canvas = el.querySelector('canvas') as HTMLCanvasElement
  const cap = Math.max(2, Math.round(windowSize * def.windowMul))

  const chartOpts = {
    series: def.series.map((s) => s.config),
    maxPoints: cap,
    autoDraw: true,
    xTicks: 5,
    yTicks: 4,
    bgColor: '#161618',
    padding: [12, 12, 24, 48] as [number, number, number, number],
  }

  const chart = def.chartType === 'area'
    ? new AreaChart(canvas, chartOpts)
    : new LineChart(canvas, chartOpts)

  const kpi = def.kpi ? buildKpi(kpiHost, def) : undefined

  return {
    def,
    chart,
    gens: def.series.map((s) => s.gen()),
    nextXs: def.series.map(() => 0),
    bx: new Float64Array(64),
    by: new Float64Array(64),
    valueEl: kpi?.value,
    rangeEl: kpi?.range,
    badgeEl: el.querySelector('.badge') as HTMLElement,
  }
}
