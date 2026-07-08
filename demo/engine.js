// Chart engine: option building, (re)build with sync handling, streaming loops,
// live readouts and the generated-config view.

// ── The ONLY place the library is imported ────────────────────────────────────
// Using the published package:
import { LineChart, AreaChart, ScatterChart, DARK, LIGHT } from '../src/index.ts';
// The demo tracks the local source directly. To use the published package instead,
// swap the line above for:
//   import { LineChart, AreaChart, ScatterChart, DARK, LIGHT } from 'goro-charts';
// ──────────────────────────────────────────────────────────────────────────────

import { P, chart, canv, stream, env, $ } from './state.js';
import { feedStatic, resetStream, scaleOf, noise, detAt } from './data.js';

const CLS = { line: LineChart, area: AreaChart, scatter: ScatterChart };

export function seriesConfigs(pi) {
  const type = P[pi].type;
  return P[pi].series.map((s) => {
    const c = { name: s.name, color: s.color, lineWidth: s.lineWidth };
    if (s.dash) c.dash = [8, 4];
    if (type === 'area') {
      c.fillColor = s.color;
      c.fillOpacity = s.fill;
      if (s.stack) c.stack = 'grp';
    }
    if (s.axis === 'right') c.yAxis = 'right';
    if (s.hidden) c.hidden = true;
    return c;
  });
}

const gridCol = (pi) => `rgba(${env.theme === 'dark' ? '255,255,255' : '0,0,0'},${P[pi].gridAlpha})`;

export function buildOpts(pi) {
  const o = {
    ...(env.theme === 'dark' ? DARK : LIGHT),
    series: seriesConfigs(pi),
    xTicks: P[pi].xTicks,
    yTicks: P[pi].yTicks,
    fontSize: P[pi].fontSize,
    gridColor: gridCol(pi),
    crosshairWidth: P[pi].crossW,
    pointRadius: P[pi].pointR,
    maxDots: P[pi].maxDots,
    bgColor: env.theme === 'dark' ? '#0c0f14' : '#ffffff',
  };
  if (P[pi].fixedY) {
    o.yMin = P[pi].yMin;
    o.yMax = P[pi].yMax;
  }
  if (P[pi].mode === 'stream') {
    o.maxPoints = P[pi].win;
    o.autoDraw = true;
  }
  return o;
}

// Pure-visual patch (no recreate) — mirrors the library's structural/visual split.
export function visualPatch(pi) {
  return {
    series: seriesConfigs(pi),
    xTicks: P[pi].xTicks,
    yTicks: P[pi].yTicks,
    fontSize: P[pi].fontSize,
    gridColor: gridCol(pi),
    crosshairWidth: P[pi].crossW,
    pointRadius: P[pi].pointR,
    maxDots: P[pi].maxDots,
  };
}

// Recreate a single panel's chart. Handles sync cleanly so the surviving panel
// never holds a stale reference to a destroyed instance.
export function rebuild(pi) {
  const other = pi ^ 1;
  if (chart[other] && chart[pi]) {
    try {
      chart[other].unsync(chart[pi]);
    } catch (e) {}
  }
  stopLoop(pi);
  if (chart[pi]) {
    chart[pi].destroy();
    chart[pi] = null;
  }
  chart[pi] = new CLS[P[pi].type](canv[pi], buildOpts(pi));
  if (P[pi].mode === 'static') {
    feedStatic(pi);
  } else {
    resetStream(pi);
    if (P[pi].running) startLoop(pi);
  }
  if (env.sync && chart[other]) chart[pi].sync(chart[other]);
  chart[pi].draw();
  renderConfig(pi);
}

export function applyVisual(pi) {
  chart[pi].setOptions(visualPatch(pi));
  renderConfig(pi);
}

export function reSyncAll() {
  if (chart[0] && chart[1]) {
    try {
      chart[0].unsync(chart[1]);
    } catch (e) {}
    if (env.sync) chart[0].sync(chart[1]);
  }
}

// ── Streaming (independent per panel) ─────────────────────────────────────────
export function startLoop(pi) {
  const st = stream[pi];
  if (st.raf) return;
  st.last = performance.now();
  st.acc = 0;
  st.raf = requestAnimationFrame((t) => tick(pi, t));
  updateLive();
}

export function stopLoop(pi) {
  const st = stream[pi];
  if (st.raf) {
    cancelAnimationFrame(st.raf);
    st.raf = null;
  }
  updateLive();
}

function tick(pi, ts) {
  const st = stream[pi];
  if (!P[pi].running) {
    st.raf = null;
    updateLive();
    return;
  }
  const dt = Math.min((ts - st.last) / 1000, 0.1);
  st.last = ts;
  st.acc += dt * P[pi].speed;
  const emit = Math.min(Math.floor(st.acc), 5000);
  st.acc -= Math.floor(st.acc);
  if (emit > 0) {
    const base = st.t;
    const walkMode = P[pi].shape === 'walk';
    if (P[pi].atomic) {
      for (let k = 0; k < emit; k++) {
        const x = base + k;
        const frame = new Map();
        P[pi].series.forEach((s, si) => {
          const { amp } = scaleOf(s);
          const y = walkMode ? (st.walk[si] += noise(amp * 0.12)) : detAt(pi, si, x);
          frame.set(si, y);
        });
        chart[pi].appendFrame(x, frame);
      }
    } else {
      P[pi].series.forEach((s, si) => {
        const { amp } = scaleOf(s);
        const xs = new Float64Array(emit);
        const ys = new Float64Array(emit);
        for (let k = 0; k < emit; k++) {
          xs[k] = base + k;
          if (walkMode) {
            st.walk[si] += noise(amp * 0.12);
            ys[k] = st.walk[si];
          } else ys[k] = detAt(pi, si, base + k);
        }
        chart[pi].appendBatch(si, xs, ys);
      });
    }
    st.t = base + emit;
  }
  st.raf = requestAnimationFrame((t) => tick(pi, t));
}

export function updateLive() {
  for (let pi = 0; pi < 2; pi++) {
    const el = $(`.panel[data-p="${pi}"] .live`);
    if (el) el.classList.toggle('on', P[pi].mode === 'stream' && P[pi].running && !!stream[pi].raf);
  }
}

// ── Readouts & generated config view ──────────────────────────────────────────
const fmt = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : '\u2014');

export function updateReadouts() {
  for (let pi = 0; pi < 2; pi++) {
    const ch = chart[pi];
    if (!ch) continue;
    const pn = $(`.panel[data-p="${pi}"]`);
    if (!pn) continue;
    pn.querySelector('.st-win').textContent = ch.windowPointCount.toLocaleString();
    pn.querySelector('.st-drawn').textContent = ch.drawnPointCount.toLocaleString();
    pn.querySelector('.readout').innerHTML = P[pi].series
      .map((s, i) =>
        s.hidden
          ? ''
          : `<span class="rchip"><span class="d" style="background:${s.color}"></span>${s.name} <span class="v">${fmt(ch.lastValue(i))}</span></span>`,
      )
      .join('');
  }
}

const esc = (s) => String(s).replace(/</g, '&lt;');

export function renderConfig(pi) {
  const type = P[pi].type;
  const cls = { line: 'LineChart', area: 'AreaChart', scatter: 'ScatterChart' }[type];
  const L = [];
  L.push(
    `<span class="k">import</span> { ${cls} } <span class="k">from</span> <span class="s">'goro-charts'</span>;`,
    '',
  );
  L.push(`<span class="k">const</span> chart = <span class="k">new</span> ${cls}(canvas, {`);
  L.push(`  series: [`);
  P[pi].series.forEach((s) => {
    let f = `    { name: <span class="s">'${esc(s.name)}'</span>, color: <span class="s">'${s.color}'</span>, lineWidth: <span class="n">${s.lineWidth}</span>`;
    if (s.dash) f += `, dash: [<span class="n">8</span>,<span class="n">4</span>]`;
    if (type === 'area') f += `, fillOpacity: <span class="n">${s.fill}</span>`;
    if (type === 'area' && s.stack) f += `, stack: <span class="s">'grp'</span>`;
    if (s.axis === 'right') f += `, yAxis: <span class="s">'right'</span>`;
    if (s.hidden) f += `, hidden: <span class="k">true</span>`;
    L.push(f + ' },');
  });
  L.push('  ],');
  if (P[pi].mode === 'stream') {
    L.push(`  maxPoints: <span class="n">${P[pi].win}</span>,`, '  autoDraw: <span class="k">true</span>,');
  }
  if (P[pi].fixedY) L.push(`  yMin: <span class="n">${P[pi].yMin}</span>, yMax: <span class="n">${P[pi].yMax}</span>,`);
  if (type === 'scatter') L.push(`  maxDots: <span class="n">${P[pi].maxDots}</span>,`);
  L.push(`  xTicks: <span class="n">${P[pi].xTicks}</span>, yTicks: <span class="n">${P[pi].yTicks}</span>,`, '});');
  if (P[pi].mode === 'stream') {
    L.push(
      '',
      `<span class="c">// ${P[pi].atomic ? 'appendFrame(x, Map) — atomic, all series' : 'appendBatch(idx, xs, ys) — per series'}</span>`,
      P[pi].atomic
        ? `<span class="k">for</span> (<span class="k">let</span> k = <span class="n">0</span>; k &lt; emit; k++) chart.appendFrame(x, <span class="k">new</span> <span class="n">Map</span>([<span class="n">0</span>, y0], [<span class="n">1</span>, y1]));`
        : `chart.appendBatch(<span class="n">0</span>, xs, ys); <span class="c">// ... per series</span>`,
    );
  }
  const pre = $(`.ctlcard[data-p="${pi}"] .cfg pre`);
  if (pre) pre.innerHTML = L.join('\n');
}
