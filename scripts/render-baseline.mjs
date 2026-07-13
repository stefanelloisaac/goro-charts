/**
 * v1.9.0 render performance baseline.
 *
 * Runs the scenarios defined in docs/phases/v1.9.0-performance-pendencias.md
 * (D1, D1-slide, D2, B1) against `dist/goro-charts.js` and reports p50/p95
 * per scenario for the `appendFrame + draw` cycle.
 */

import { createCanvas } from 'canvas';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = pathToFileURL(join(__dirname, '..', 'dist', 'goro-charts.js')).href;

function patchCanvas(cv) {
  cv.getBoundingClientRect = () => ({
    width: cv.width,
    height: cv.height,
    top: 0,
    left: 0,
    right: cv.width,
    bottom: cv.height,
    x: 0,
    y: 0,
  });
  cv.style = {};
  cv.setAttribute = () => {};
  cv.addEventListener = () => {};
  cv.removeEventListener = () => {};
  cv.dispatchEvent = () => true;
  Object.defineProperty(cv, 'tabIndex', { value: 0, writable: true });
  return cv;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: samples.reduce((s, v) => s + v, 0) / samples.length,
  };
}

function fmt(v) {
  return v.toFixed(3).padStart(7);
}

const reportLines = [];

function report(name, samples, target) {
  const s = stats(samples);
  const flag = target ? (s.p50 < target ? ' PASS' : ' FAIL') : '     ';
  reportLines.push(
    `${name.padEnd(32)} p50=${fmt(s.p50)}ms  p95=${fmt(s.p95)}ms  mean=${fmt(s.mean)}ms  max=${fmt(s.max)}ms  n=${s.n}${flag}`,
  );
}

function measure(samples, fn) {
  const t = performance.now();
  fn();
  samples.push(performance.now() - t);
}

function makeGlobals() {
  globalThis.HTMLCanvasElement = class {};
  globalThis.window = globalThis.window || {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = globalThis.document || {
    createElement: (tag) => {
      if (tag === 'canvas') return patchCanvas(createCanvas(800, 400));
      return { style: {}, setAttribute: () => {}, appendChild: () => {}, remove: () => {}, addEventListener: () => {} };
    },
    body: { appendChild: () => {}, contains: () => true },
  };
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

async function main() {
  makeGlobals();
  const mod = await import(distPath);
  const { LineChart } = mod;

  const warmup = 100;
  const runs = 500;

  reportLines.push('=== goro-charts render baseline ===');
  reportLines.push(`Canvas: 800x400  |  Warmup: ${warmup} |  Samples: ${runs}`);
  reportLines.push('');

  // D1
  {
    const cv = patchCanvas(createCanvas(800, 400));
    const chart = new LineChart(cv, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
        { id: 'c', name: 'C', color: '#00f' },
      ],
      maxPoints: 10_000,
      autoDraw: false,
    });
    for (let i = 0; i < 9_500; i++) {
      chart.appendFrame(i, { a: Math.sin(i * 0.01), b: Math.cos(i * 0.01), c: Math.sin(i * 0.005) });
    }
    chart.draw();
    for (let i = 0; i < warmup; i++) {
      chart.appendFrame(9_500 + i, { a: 0.1, b: 0.2, c: 0.3 });
      chart.draw();
    }
    const samples = [];
    for (let i = 0; i < runs; i++) {
      measure(samples, () => {
        chart.appendFrame(9_500 + warmup + i, { a: 0.1, b: 0.2, c: 0.3 });
        chart.draw();
      });
    }
    report('D1 (10k, 3 series)', samples, 16);
    chart.destroy();
  }

  // D1-slide
  {
    const cv = patchCanvas(createCanvas(800, 400));
    const chart = new LineChart(cv, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
        { id: 'c', name: 'C', color: '#00f' },
      ],
      maxPoints: 10_000,
      autoDraw: false,
    });
    for (let i = 0; i < 15_000; i++) {
      chart.appendFrame(i, { a: Math.sin(i * 0.01), b: Math.cos(i * 0.01), c: Math.sin(i * 0.005) });
    }
    chart.draw();
    for (let i = 0; i < warmup; i++) {
      chart.appendFrame(15_000 + i, { a: 0.1, b: 0.2, c: 0.3 });
      chart.draw();
    }
    const samples = [];
    for (let i = 0; i < runs; i++) {
      measure(samples, () => {
        chart.appendFrame(15_000 + warmup + i, { a: 0.1, b: 0.2, c: 0.3 });
        chart.draw();
      });
    }
    report('D1-slide (ring cheio deslize)', samples, 16);
    chart.destroy();
  }

  // D2
  {
    const cv = patchCanvas(createCanvas(800, 400));
    const chart = new LineChart(cv, {
      series: [
        { id: 'a', name: 'A', color: '#f00' },
        { id: 'b', name: 'B', color: '#0f0' },
        { id: 'c', name: 'C', color: '#00f' },
      ],
      maxPoints: 100_000,
      autoDraw: false,
    });
    for (let i = 0; i < 95_000; i++) {
      chart.appendFrame(i, { a: Math.sin(i * 0.01), b: Math.cos(i * 0.01), c: Math.sin(i * 0.005) });
    }
    chart.draw();
    for (let i = 0; i < warmup; i++) {
      chart.appendFrame(95_000 + i, { a: 0.1, b: 0.2, c: 0.3 });
      chart.draw();
    }
    const samples = [];
    for (let i = 0; i < runs; i++) {
      measure(samples, () => {
        chart.appendFrame(95_000 + warmup + i, { a: 0.1, b: 0.2, c: 0.3 });
        chart.draw();
      });
    }
    report('D2 (100k, 3 series)', samples, 60);
    chart.destroy();
  }

  // B1
  {
    const N_CHARTS = 20;
    const charts = [];
    for (let k = 0; k < N_CHARTS; k++) {
      const cv = patchCanvas(createCanvas(400, 200));
      const chart = new LineChart(cv, {
        series: [
          { id: 'a', name: 'A', color: '#f00' },
          { id: 'b', name: 'B', color: '#0f0' },
        ],
        autoDraw: false,
      });
      const xs = new Float64Array(2000);
      const ya = new Float64Array(2000);
      const yb = new Float64Array(2000);
      for (let i = 0; i < 2000; i++) {
        xs[i] = i;
        ya[i] = Math.sin(i * 0.01 + k) * 50 + 50;
        yb[i] = Math.cos(i * 0.01 + k) * 50 + 50;
      }
      chart.setData('a', xs, ya);
      chart.setData('b', xs, yb);
      chart.draw();
      charts.push(chart);
    }
    for (let i = 0; i < 10; i++) for (const c of charts) c.draw();
    const samples = [];
    for (let i = 0; i < 50; i++) {
      for (const c of charts) c.setOptions({ textColor: i % 2 ? '#fff' : '#eee' });
      const t = performance.now();
      for (const c of charts) c.draw();
      samples.push(performance.now() - t);
    }
    report('B1 (20 charts x 2 series)', samples);
    for (const c of charts) c.destroy();
  }

  // Fast path
  {
    const cv = patchCanvas(createCanvas(800, 400));
    const chart = new LineChart(cv, {
      series: [{ id: 'a', name: 'A', color: '#f00' }],
      maxPoints: 10_000,
      autoDraw: false,
    });
    for (let i = 0; i < 500; i++) chart.append('a', i, Math.sin(i * 0.01));
    chart.setViewport({ xMin: 100, xMax: 400, yAuto: false });
    chart.setOptions({ yMin: -1, yMax: 1 });
    chart.draw();
    for (let i = 0; i < warmup; i++) {
      chart.append('a', 500 + i, Math.sin((500 + i) * 0.01));
      chart.draw();
    }
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      chart.append('a', 500 + warmup + i, Math.sin((500 + warmup + i) * 0.01));
      chart.draw();
      samples.push(performance.now() - t);
    }
    report('Fast path (viewport fixo)', samples, 2);
    chart.destroy();
  }

  // Flush all scenario rows in one synchronous write so redirected output is
  // never truncated by async stdout buffering on process exit.
  process.stdout.write(reportLines.join('\n') + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
