/**
 * @file The metrics strip (points/sec, draw timings, ticks, totals).
 *
 * Builds the metric cards once and returns handles to their value elements so
 * the tick loop can update text without re-querying the DOM.
 */

/** Keyed value elements for the metrics strip. */
export type MetricEls = Record<string, HTMLElement>

/** Build the five metric cards under `host` and return their value nodes. */
export function buildMetrics(host: HTMLElement): MetricEls {
  const els: MetricEls = {}
  const add = (key: string, label: string) => {
    const el = document.createElement('div')
    el.className = 'metric'
    el.innerHTML = `<div class="label">${label}</div><div class="value">—</div>`
    host.appendChild(el)
    els[key] = el.querySelector('.value') as HTMLElement
  }
  add('pps', 'Points / sec')
  add('last', 'Last draw')
  add('avg', 'Avg draw')
  add('ticks', 'Ticks')
  add('total', 'Total points')
  return els
}
