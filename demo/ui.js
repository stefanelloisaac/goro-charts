// UI layer: builds each column's markup, renders the series editor,
// wires every control to the engine, and wires the global header.
import { P, chart, canv, env, $, PAL } from './state.js';
import { feedStatic, clearStream } from './data.js';
import { rebuild, applyVisual, reSyncAll, updateReadouts, renderConfig } from './engine.js';

export function colHTML(pi) {
  const t = P[pi].type;
  const id = pi ? 'B' : 'A';
  const typeSeg = ['line', 'area', 'scatter']
    .map((k) => `<button data-t="${k}" class="${t === k ? 'on' : ''}">${k}</button>`)
    .join('');
  return `
    <div class="col ${pi ? 'b' : ''}">
      <div class="panel" data-p="${pi}">
        <div class="phead">
          <span class="pid">PANEL <b>${id}</b></span>
          <div class="seg typeSeg">${typeSeg}</div>
          <span class="live"><span class="rec"></span>live</span>
          <div class="pstats">
            <span><b>window</b> <span class="num st-win">0</span></span>
            <span><b>drawn</b> <span class="num st-drawn">0</span></span>
          </div>
        </div>
        <div class="canvas-wrap"><canvas></canvas><div class="scan"></div></div>
        <div class="readout"></div>
        <div class="pfoot"><button class="btn sm png">&#8681; Export PNG</button></div>
      </div>

      <div class="ctlcard" data-p="${pi}">
        <div class="cchead"><span class="cctitle">PANEL <b>${id}</b> &mdash; CONTROLS</span></div>
        <div class="ccbody">

          <div class="sub">Data source</div>
          <div class="field">
            <div class="seg c-mode">
              <button data-v="static" class="${P[pi].mode === 'static' ? 'on' : ''}">Static</button>
              <button data-v="stream" class="${P[pi].mode === 'stream' ? 'on' : ''}">Streaming</button>
            </div>
          </div>
          <div class="grid2">
            <div class="field"><div class="fl"><label>Signal shape</label></div>
              <select class="c-shape">
                <option value="sine">Sine waves</option><option value="noisy">Noisy sine</option>
                <option value="walk">Random walk</option><option value="steps">Step function</option>
              </select></div>
            <div class="field"><div class="fl"><label class="c-win-lbl">Sample count</label><span class="val c-win-val">${P[pi].win}</span></div>
              <input type="range" class="c-win" min="50" max="5000" step="50" value="${P[pi].win}"></div>
          </div>
          <div class="field c-speed-box" style="display:${P[pi].mode === 'stream' ? 'block' : 'none'}">
            <div class="fl"><label>Stream rate</label><span class="val c-speed-val">${P[pi].speed} pts/s</span></div>
            <input type="range" class="c-speed" min="2" max="240" step="2" value="${P[pi].speed}">
          </div>
          <div class="field c-atomic-box" style="display:${P[pi].mode === 'stream' ? 'block' : 'none'}">
            <div class="tog c-atomic ${P[pi].atomic ? 'on' : ''}"><span>Atomic frame (appendFrame)</span><span class="switch"></span></div>
          </div>
          <div class="btnrow"><button class="btn sm c-regen">&#8635; Regenerate</button><button class="btn sm c-stress">Load 100k</button></div>

          <div class="sub">Grid &amp; axes</div>
          <div class="grid2">
            <div class="field"><div class="fl"><label>X ticks</label><span class="val c-xt-val">${P[pi].xTicks}</span></div><input type="range" class="c-xt" min="2" max="16" step="1" value="${P[pi].xTicks}"></div>
            <div class="field"><div class="fl"><label>Y ticks</label><span class="val c-yt-val">${P[pi].yTicks}</span></div><input type="range" class="c-yt" min="2" max="14" step="1" value="${P[pi].yTicks}"></div>
            <div class="field"><div class="fl"><label>Font size</label><span class="val c-fs-val">${P[pi].fontSize}px</span></div><input type="range" class="c-fs" min="8" max="18" step="1" value="${P[pi].fontSize}"></div>
            <div class="field"><div class="fl"><label>Grid opacity</label><span class="val c-ga-val">${P[pi].gridAlpha.toFixed(2)}</span></div><input type="range" class="c-ga" min="0" max="0.4" step="0.01" value="${P[pi].gridAlpha}"></div>
          </div>

          <div class="sub">Y domain</div>
          <div class="field"><div class="tog c-fix ${P[pi].fixedY ? 'on' : ''}"><span>Fixed Y range</span><span class="switch"></span></div></div>
          <div class="grid2 c-ybox" style="opacity:${P[pi].fixedY ? 1 : 0.4};pointer-events:${P[pi].fixedY ? 'auto' : 'none'}">
            <div class="field"><div class="fl"><label>Y min</label><span class="val c-ymin-val">${P[pi].yMin}</span></div><input type="range" class="c-ymin" min="-500" max="500" step="10" value="${P[pi].yMin}"></div>
            <div class="field"><div class="fl"><label>Y max</label><span class="val c-ymax-val">${P[pi].yMax}</span></div><input type="range" class="c-ymax" min="0" max="1000" step="10" value="${P[pi].yMax}"></div>
          </div>

          <div class="sub">Crosshair &amp; markers</div>
          <div class="grid2">
            <div class="field"><div class="fl"><label>Guide width</label><span class="val c-cw-val">${P[pi].crossW}</span></div><input type="range" class="c-cw" min="1" max="4" step="0.5" value="${P[pi].crossW}"></div>
            <div class="field"><div class="fl"><label>Marker radius</label><span class="val c-pr-val">${P[pi].pointR}</span></div><input type="range" class="c-pr" min="2" max="9" step="0.5" value="${P[pi].pointR}"></div>
            <div class="field c-md-box" style="grid-column:1/-1;display:${t === 'scatter' ? 'block' : 'none'}"><div class="fl"><label>Scatter max dots</label><span class="val c-md-val">${P[pi].maxDots}</span></div><input type="range" class="c-md" min="200" max="8000" step="200" value="${P[pi].maxDots}"></div>
          </div>

          <div class="sub">Series</div>
          <div class="slist c-slist"></div>
          <div class="btnrow" style="margin-top:10px"><button class="btn sm c-add">+ Add series</button></div>

          <details class="cfg"><summary>Show config</summary><pre></pre></details>
        </div>
      </div>
    </div>`;
}

export function renderSeries(pi) {
  const list = $(`.ctlcard[data-p="${pi}"] .c-slist`);
  list.innerHTML = P[pi].series
    .map(
      (s, i) => `
      <div class="srow" data-i="${i}">
        <div class="top">
          <span class="swatch" style="background:${s.color}"><input type="color" value="${s.color}" data-k="color"></span>
          <input class="sname" value="${s.name.replace(/"/g, '&quot;')}" data-k="name">
          <button class="xbtn" data-act="del" title="Remove">&times;</button>
        </div>
        <div class="params">
          <div class="mini"><label>W</label><input type="range" min="0.5" max="4" step="0.1" value="${s.lineWidth}" data-k="lineWidth"></div>
          <div class="mini"><label>Fill</label><input type="range" min="0" max="0.6" step="0.02" value="${s.fill}" data-k="fill"></div>
          <span class="chip ${s.dash ? 'on' : ''}" data-k="dash">Dash</span>
          <span class="chip ${s.axis === 'right' ? 'on' : ''}" data-k="axis">${s.axis === 'right' ? 'R axis' : 'L axis'}</span>
          <span class="chip ${s.stack ? 'on' : ''}" data-k="stack">Stack</span>
          <span class="chip danger ${s.hidden ? 'on' : ''}" data-k="hidden">${s.hidden ? 'Hidden' : 'Visible'}</span>
        </div>
      </div>`,
    )
    .join('');

  list.querySelectorAll('.srow').forEach((row) => {
    const i = +row.dataset.i;
    const s = P[pi].series[i];
    row.querySelector('[data-k="color"]').oninput = (e) => {
      s.color = e.target.value;
      row.querySelector('.swatch').style.background = s.color;
      applyVisual(pi);
      updateReadouts();
    };
    row.querySelector('[data-k="name"]').oninput = (e) => {
      s.name = e.target.value;
      applyVisual(pi);
    };
    row.querySelector('[data-k="lineWidth"]').oninput = (e) => {
      s.lineWidth = +e.target.value;
      applyVisual(pi);
    };
    row.querySelector('[data-k="fill"]').oninput = (e) => {
      s.fill = +e.target.value;
      applyVisual(pi);
    };
    row.querySelector('[data-act="del"]').onclick = () => {
      if (P[pi].series.length <= 1) return;
      P[pi].series.splice(i, 1);
      renderSeries(pi);
      rebuild(pi);
    };
    row.querySelectorAll('.chip').forEach(
      (chip) =>
        (chip.onclick = () => {
          const k = chip.dataset.k;
          if (k === 'dash') {
            s.dash = !s.dash;
            applyVisual(pi);
          } else if (k === 'hidden') {
            s.hidden = !s.hidden;
            applyVisual(pi);
            updateReadouts();
          } else if (k === 'stack') {
            s.stack = !s.stack;
            applyVisual(pi);
          } else if (k === 'axis') {
            s.axis = s.axis === 'right' ? 'left' : 'right';
            if (P[pi].mode === 'stream') clearStream(pi);
            applyVisual(pi);
            if (P[pi].mode === 'static') {
              feedStatic(pi);
              chart[pi].draw();
            }
          }
          renderSeries(pi);
        }),
    );
  });
}

export function wireCard(pi) {
  const pn = $(`.panel[data-p="${pi}"]`);
  const card = $(`.ctlcard[data-p="${pi}"]`);
  canv[pi] = pn.querySelector('canvas');

  pn.querySelectorAll('.typeSeg button').forEach(
    (b) =>
      (b.onclick = () => {
        P[pi].type = b.dataset.t;
        pn.querySelectorAll('.typeSeg button').forEach((x) => x.classList.toggle('on', x === b));
        card.querySelector('.c-md-box').style.display = P[pi].type === 'scatter' ? 'block' : 'none';
        rebuild(pi);
      }),
  );
  pn.querySelector('.png').onclick = () => {
    const a = document.createElement('a');
    a.href = chart[pi].toImage();
    a.download = `goro-panel-${pi ? 'B' : 'A'}.png`;
    a.click();
  };

  card.querySelectorAll('.c-mode button').forEach(
    (b) =>
      (b.onclick = () => {
        P[pi].mode = b.dataset.v;
        card.querySelectorAll('.c-mode button').forEach((x) => x.classList.toggle('on', x === b));
        card.querySelector('.c-speed-box').style.display = P[pi].mode === 'stream' ? 'block' : 'none';
        card.querySelector('.c-atomic-box').style.display = P[pi].mode === 'stream' ? 'block' : 'none';
        card.querySelector('.c-win-lbl').textContent = P[pi].mode === 'stream' ? 'Window size' : 'Sample count';
        P[pi].running = P[pi].mode === 'stream';
        rebuild(pi);
      }),
  );

  card.querySelector('.c-shape').value = P[pi].shape;
  card.querySelector('.c-shape').onchange = (e) => {
    P[pi].shape = e.target.value;
    if (P[pi].mode === 'stream') clearStream(pi);
    else {
      feedStatic(pi);
      chart[pi].draw();
    }
  };

  const win = card.querySelector('.c-win');
  win.oninput = (e) => {
    P[pi].win = +e.target.value;
    card.querySelector('.c-win-val').textContent = P[pi].win;
  };
  win.onchange = () => rebuild(pi);

  card.querySelector('.c-speed').oninput = (e) => {
    P[pi].speed = +e.target.value;
    card.querySelector('.c-speed-val').textContent = P[pi].speed + ' pts/s';
  };
  card.querySelector('.c-regen').onclick = () => {
    if (P[pi].mode === 'static') {
      feedStatic(pi);
      chart[pi].draw();
    } else clearStream(pi);
  };
  card.querySelector('.c-stress').onclick = () => {
    P[pi].mode = 'static';
    P[pi].running = false;
    card.querySelectorAll('.c-mode button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'static'));
    card.querySelector('.c-speed-box').style.display = 'none';
    card.querySelector('.c-atomic-box').style.display = 'none';
    P[pi].win = 100000;
    card.querySelector('.c-win').value = 5000;
    card.querySelector('.c-win-val').textContent = '100,000';
    rebuild(pi);
  };

  const bindV = (sel, valSel, key, f) => {
    card.querySelector(sel).oninput = (e) => {
      P[pi][key] = +e.target.value;
      card.querySelector(valSel).textContent = f(P[pi][key]);
      applyVisual(pi);
    };
  };
  bindV('.c-xt', '.c-xt-val', 'xTicks', (v) => v);
  bindV('.c-yt', '.c-yt-val', 'yTicks', (v) => v);
  bindV('.c-fs', '.c-fs-val', 'fontSize', (v) => v + 'px');
  bindV('.c-ga', '.c-ga-val', 'gridAlpha', (v) => v.toFixed(2));
  bindV('.c-cw', '.c-cw-val', 'crossW', (v) => v);
  bindV('.c-pr', '.c-pr-val', 'pointR', (v) => v);
  bindV('.c-md', '.c-md-val', 'maxDots', (v) => v);

  card.querySelector('.c-fix').onclick = () => {
    P[pi].fixedY = !P[pi].fixedY;
    card.querySelector('.c-fix').classList.toggle('on', P[pi].fixedY);
    const box = card.querySelector('.c-ybox');
    box.style.opacity = P[pi].fixedY ? 1 : 0.4;
    box.style.pointerEvents = P[pi].fixedY ? 'auto' : 'none';
    rebuild(pi);
  };
  card.querySelector('.c-atomic').onclick = () => {
    P[pi].atomic = !P[pi].atomic;
    card.querySelector('.c-atomic').classList.toggle('on', P[pi].atomic);
    if (P[pi].mode === 'stream') clearStream(pi);
    renderConfig(pi);
  };
  const ymin = card.querySelector('.c-ymin');
  const ymax = card.querySelector('.c-ymax');
  ymin.oninput = (e) => {
    P[pi].yMin = +e.target.value;
    card.querySelector('.c-ymin-val').textContent = P[pi].yMin;
  };
  ymax.oninput = (e) => {
    P[pi].yMax = +e.target.value;
    card.querySelector('.c-ymax-val').textContent = P[pi].yMax;
  };
  ymin.onchange = ymax.onchange = () => {
    if (P[pi].fixedY) rebuild(pi);
  };

  card.querySelector('.c-add').onclick = () => {
    if (P[pi].series.length >= 5) return;
    const i = P[pi].series.length;
    P[pi].series.push({
      name: 'Series ' + String.fromCharCode(65 + i),
      color: PAL[i % PAL.length],
      lineWidth: 1.6,
      dash: false,
      fill: 0.14,
      axis: 'left',
      stack: false,
      hidden: false,
    });
    renderSeries(pi);
    rebuild(pi);
  };

  renderSeries(pi);
}

export function wireHeader() {
  $('#themeBtn').onclick = () => {
    env.theme = env.theme === 'dark' ? 'light' : 'dark';
    document.body.classList.toggle('light', env.theme === 'light');
    document.body.classList.toggle('dark', env.theme === 'dark');
    rebuild(0);
    rebuild(1);
  };
  $('#syncBtn').onclick = () => {
    env.sync = !env.sync;
    $('#syncBtn').classList.toggle('on', env.sync);
    reSyncAll();
  };

  const copy = (from, to) => {
    P[to] = JSON.parse(JSON.stringify(P[from]));
    P[to].running = P[to].mode === 'stream';
    const col = $(`.ctlcard[data-p="${to}"]`).closest('.col');
    col.outerHTML = colHTML(to);
    wireCard(to);
    rebuild(to);
    reSyncAll();
  };
  $('#copyAB').onclick = () => copy(0, 1);
  $('#copyBA').onclick = () => copy(1, 0);
}
