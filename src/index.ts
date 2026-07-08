/**
 * @file Public entry point. Re-exports the chart API surface.
 *
 * Consumers import only from here. Internal modules (data/, render/, math/,
 * charts/) are implementation detail and may change without affecting this
 * contract.
 */

export { LineChart } from './charts/line-chart.ts';
export { AreaChart } from './charts/area-chart.ts';
export { ScatterChart } from './charts/scatter-chart.ts';
export { DARK, LIGHT } from './presets.ts';
export type {
  ChartOpts,
  ChartOptionsPatch,
  SeriesConfig,
  SeriesRef,
  DataOwnership,
  ChartFrameValues,
  ChartEventMap,
  ChartEventType,
  ChartEventListener,
  FrameAppendedEvent,
  ChartDestroyedEvent,
} from './types.ts';
export type { SeriesHit } from './render/crosshair.ts';
