/**
 * @file Public entry point. Re-exports the chart API surface.
 *
 * Consumers import only from here. Internal modules (data/, render/, math/,
 * charts/) are implementation detail and may change without affecting this
 * contract.
 */

export { LineChart } from './charts/line-chart.ts'
export { AreaChart } from './charts/area-chart.ts'
export type { ChartOpts } from './types.ts'
