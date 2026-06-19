/**
 * @file Panel definitions and DOM/chart construction for the demo.
 *
 * Three live panels in a 3-column grid:
 *   - CPU + Req/s: {@link LineChart} with CPU (random walk, left) + Req/s (noisy sine, dual Y right)
 *   - Requests/sec: {@link AreaChart} with Req/s (area fill) + Baseline (line)
 *   - Network: {@link ScatterChart} with Packets (spiky) + Errors (spiky, dashed)
 */

import { LineChart, AreaChart, ScatterChart } from '../src/index.ts'
import {
  randomWalkGen,
  slowSineGen,
  noisySineGen,
  spikyGen,
  type Generator,
} from './generators.ts'
import type { SeriesConfig } from '../src/types.ts'

interface SeriesDef {
  config: SeriesConfig
  gen: () => Generator
}

export interface PanelDef {
  id: string
  title: string
  chartType: 'line' | 'area' | 'scatter'
  series: SeriesDef[]
  windowMul: number
  batchMul: number
  kpiSeries?: number
  kpi?: { label: string; unit: string; digits?: number }
}

export interface Panel {
  def: PanelDef
  chart: LineChart | AreaChart | ScatterChart
  gens: Generator[]
  nextXs: number[]
  bx: Float64Array
  by: Float64Array
  valueEl?: HTMLElement
  rangeEl?: HTMLElement
  badgeEl: HTMLElement
}

export const PANELS: PanelDef[] = [
  {
    id: 'cpu', title: 'CPU + Req/s (dual Y)', chartType: 'line', windowMul: 1, batchMul: 1,
    series: [
      { config: { name: 'CPU', color: '#4ea8ff', lineWidth: 3 }, gen: () => randomWalkGen() },
      { config: { name: 'Req/s', color: '#ffb454', lineWidth: 1.2, dash: [8, 4], yAxis: 'right' }, gen: () => noisySineGen() },
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
  {
    id: 'net', title: 'Network Activity', chartType: 'scatter', windowMul: 1, batchMul: 1,
    series: [
      { config: { name: 'Packets', color: '#f07167' }, gen: () => spikyGen() },
      { config: { name: 'Errors', color: '#ffb454', dash: [4, 4] }, gen: () => spikyGen() },
    ],
    kpi: { label: 'Net', unit: ' MB/s', digits: 1 },
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

  let chart: LineChart | AreaChart | ScatterChart
  if (def.chartType === 'area') chart = new AreaChart(canvas, chartOpts)
  else if (def.chartType === 'scatter') chart = new ScatterChart(canvas, chartOpts)
  else chart = new LineChart(canvas, chartOpts)

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
