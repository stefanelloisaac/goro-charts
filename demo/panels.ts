/**
 * @file Panel definitions and DOM/chart construction for the demo.
 *
 * Two live panels in a 2-column grid: a {@link LineChart} and an
 * {@link AreaChart}, both in ring (streaming) mode.
 */

import { LineChart, AreaChart } from '../src/index.ts'
import {
  randomWalkGen,
  noisySineGen,
  type Generator,
} from './generators.ts'

/** Static configuration for one panel. */
export interface PanelDef {
  id: string
  title: string
  color: string
  /** Window size multiplier relative to the global window. */
  windowMul: number
  /** Batch size multiplier relative to the global points/tick. */
  batchMul: number
  makeGen: () => Generator
  chartType: 'line' | 'area'
  kpi?: { label: string; unit: string; digits?: number }
}

/** Live runtime state for one panel. */
export interface Panel {
  def: PanelDef
  chart: LineChart | AreaChart
  gen: Generator
  nextX: number
  bx: Float64Array
  by: Float64Array
  valueEl?: HTMLElement
  rangeEl?: HTMLElement
  badgeEl: HTMLElement
}

/** The dashboard's panels, in render order. */
export const PANELS: PanelDef[] = [
  { id: 'cpu', title: 'CPU Load', color: '#4ea8ff', windowMul: 1, batchMul: 1, makeGen: () => randomWalkGen(), kpi: { label: 'CPU', unit: '%' }, chartType: 'line' },
  { id: 'req', title: 'Requests / sec', color: '#52d4a0', windowMul: 1, batchMul: 1, makeGen: () => noisySineGen(), kpi: { label: 'Req/s', unit: '' }, chartType: 'area' },
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
      <span class="dot" style="background:${def.color}"></span>
      <span class="title">${def.title}</span>
      <span class="badge">—</span>
    </div>
    <canvas></canvas>`
  gridHost.appendChild(el)

  const canvas = el.querySelector('canvas') as HTMLCanvasElement
  const cap = Math.max(2, Math.round(windowSize * def.windowMul))

  const chartOpts = {
    maxPoints: cap,
    autoDraw: true,
    lineColor: def.color,
    pointColor: def.color,
    lineWidth: 1.4,
    fillColor: '#52d4a0',
    fillOpacity: 0.08,
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
    gen: def.makeGen(),
    nextX: 0,
    bx: new Float64Array(64),
    by: new Float64Array(64),
    valueEl: kpi?.value,
    rangeEl: kpi?.range,
    badgeEl: el.querySelector('.badge') as HTMLElement,
  }
}
