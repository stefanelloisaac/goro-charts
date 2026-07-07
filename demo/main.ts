/**
 * @file Goro Charts — Streaming Dashboard Demo
 *
 * Demonstrates idiomatic library usage:
 *   - Chart creation: `new LineChart(canvas, opts)`
 *   - Data feeding:   `chart.append(seriesIndex, x, y)`
 *   - Crosshair sync:  `chart.sync(otherChart)`
 *   - Custom tooltips: `chart.onHover = (hits) => { ... }`
 *   - KPI metrics:     `chart.lastValue()`, `chart.extentMin()`, `chart.extentMax()`
 *   - Point counts:    `chart.pointCount()`
 *   - Reset:           `chart.clear()`
 */

import { LineChart, AreaChart, ScatterChart } from '../src/index.ts';
import { nextRandomWalk, nextNoisySine, nextSpiky } from './generators.ts';
import type { RandomWalkState, NoisySineState, SpikyState } from './generators.ts';

// ---- 1. Select canvases from the static HTML --------------------------

const canvases = document.querySelectorAll<HTMLCanvasElement>('#grid canvas');

// ---- 2. Create charts — one constructor call per chart -----------------

const SHARED = {
  maxPoints: 2000,
  autoDraw: true,
  bgColor: '#161618',
  padding: [12, 12, 24, 48] as [number, number, number, number],
  xTicks: 5,
  yTicks: 4,
};

const cpuChart = new LineChart(canvases[0], {
  ...SHARED,
  series: [
    { name: 'CPU', color: '#4ea8ff', lineWidth: 1.6, yMin: 0, yMax: 100 },
    { name: 'Req/s', color: '#ffb454', lineWidth: 1.2, dash: [8, 4], yAxis: 'right' },
  ],
});

const reqChart = new AreaChart(canvases[1], {
  ...SHARED,
  series: [
    { name: 'User', color: '#4ea8ff', fillColor: '#4ea8ff', fillOpacity: 0.12, stack: 'reqs' },
    { name: 'Sys', color: '#52d4a0', fillColor: '#52d4a0', fillOpacity: 0.12, stack: 'reqs' },
  ],
});

const netChart = new ScatterChart(canvases[2], {
  ...SHARED,
  series: [
    { name: 'Packets', color: '#f07167' },
    { name: 'Errors', color: '#ffb454', dash: [4, 4] },
  ],
});

// ---- 3. Crosshair sync — bidirectionally link two charts ---------------

cpuChart.sync(reqChart);

// ---- 4. Signal generator state — plain objects, no closures ------------

const cpuGen: RandomWalkState = { v: 50 };
const reqGen: NoisySineState = { i: 0, base: 8000, amp: 2500, period: 400, noise: 1200 };
const userGen: NoisySineState = { i: 0, base: 4000, amp: 1200, period: 400, noise: 300 };
const sysGen: NoisySineState = { i: 0, base: 2000, amp: 600, period: 350, noise: 250 };
const pktGen: SpikyState = { v: 10 };
const errGen: SpikyState = { v: 10 };

// ---- 6. KPI elements — cached once, updated per tick -------------------

const kpiValues = document.querySelectorAll<HTMLElement>('#kpis .value');
const kpiRanges = document.querySelectorAll<HTMLElement>('#kpis .range');
const badges = document.querySelectorAll<HTMLElement>('#grid .badge');
const footerEl = document.getElementById('footer')!;

// ---- 7. Tick loop — feed one point per series per tick -----------------

let x = 0;
let tickCount = 0;
let totalPoints = 0;

function tick(): void {
  // Line chart: CPU (series 0) + Req/s (series 1)
  cpuChart.append(0, x, nextRandomWalk(cpuGen));
  cpuChart.append(1, x, nextNoisySine(reqGen));

  // Area chart: User (series 0) + Sys (series 1)
  reqChart.append(0, x, nextNoisySine(userGen));
  reqChart.append(1, x, nextNoisySine(sysGen));

  // Scatter chart: Packets (series 0) + Errors (series 1)
  netChart.append(0, x, nextSpiky(pktGen));
  netChart.append(1, x, nextSpiky(errGen));

  x++;
  tickCount++;
  totalPoints += 6;

  updateKpis();
}

// ---- 8. Drive KPI cards and badges from the chart API ------------------

function updateKpis(): void {
  // CPU KPI (series 0)
  kpiValues[0].textContent = `${cpuChart.lastValue(0).toFixed(0)}%`;
  kpiRanges[0].textContent = [
    `min ${cpuChart.extentMin(0).toFixed(0)}%`,
    `max ${cpuChart.extentMax(0).toFixed(0)}%`,
  ].join(' · ');

  // Req/s KPI (series 0)
  kpiValues[1].textContent = reqChart.lastValue(0).toFixed(0);
  kpiRanges[1].textContent = [
    `min ${reqChart.extentMin(0).toFixed(0)}`,
    `max ${reqChart.extentMax(0).toFixed(0)}`,
  ].join(' · ');

  // Network KPI (series 0)
  kpiValues[2].textContent = `${netChart.lastValue(0).toFixed(1)} MB/s`;
  kpiRanges[2].textContent = [
    `min ${netChart.extentMin(0).toFixed(1)}`,
    `max ${netChart.extentMax(0).toFixed(1)}`,
  ].join(' · ');

  // Point-count badges
  badges[0].textContent = `${cpuChart.pointCount(0)} pts`;
  badges[1].textContent = `${reqChart.pointCount(0)} pts`;
  badges[2].textContent = `${netChart.pointCount(0)} pts`;

  // Footer
  footerEl.textContent = [
    `${tickCount} ticks`,
    `${totalPoints} pts`,
    'dual‑Y',
    'stacked area',
    'scatter',
    'synced crosshair',
  ].join(' · ');
}

// ---- 9. Controls -------------------------------------------------------

const intervalEl = document.getElementById('interval') as HTMLInputElement;
const intervalVal = document.getElementById('intervalVal')!;
const toggleBtn = document.getElementById('toggle') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;

let intervalMs = +intervalEl.value || 1000;
let running = true;
let timerId: ReturnType<typeof setInterval> | null = null;

function startLoop(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  if (running && intervalMs > 0) {
    timerId = setInterval(tick, Math.max(16, intervalMs));
  }
}

intervalEl.addEventListener('input', () => {
  intervalMs = +intervalEl.value;
  intervalVal.textContent = `${intervalMs} ms`;
  startLoop();
});

toggleBtn.addEventListener('click', () => {
  running = !running;
  toggleBtn.textContent = running ? 'Pause' : 'Start';
  toggleBtn.classList.toggle('primary', running);
  startLoop();
});

resetBtn.addEventListener('click', () => {
  // Clear all chart data
  cpuChart.clear();
  reqChart.clear();
  netChart.clear();

  // Reset generator state
  cpuGen.v = 50;
  reqGen.i = 0;
  userGen.i = 0;
  sysGen.i = 0;
  pktGen.v = 10;
  errGen.v = 10;

  // Reset counters
  x = 0;
  tickCount = 0;
  totalPoints = 0;

  // Reset UI elements
  kpiValues.forEach((el) => (el.textContent = '—'));
  kpiRanges.forEach((el) => (el.textContent = '—'));
  badges.forEach((el) => (el.textContent = '—'));
  footerEl.textContent = '';

  // Run one tick to re-seed the view
  tick();
});

// ---- 10. Go! -----------------------------------------------------------

intervalVal.textContent = `${intervalMs} ms`;
tick();
startLoop();
