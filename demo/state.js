// Shared, mutable state for the two independent chart panels.
// Other modules import these bindings and mutate their contents in place.

export const PAL = ['#4ea8ff', '#52d4a0', '#ffb454', '#c792ff', '#f07167'];

export const $ = (sel, root = document) => root.querySelector(sel);

export function defaultPanel(pi) {
  const base = [
    {
      name: 'Series A',
      color: PAL[0],
      lineWidth: 1.6,
      dash: false,
      fill: 0.14,
      axis: 'left',
      stack: false,
      hidden: false,
    },
    {
      name: 'Series B',
      color: PAL[1],
      lineWidth: 1.6,
      dash: false,
      fill: 0.14,
      axis: 'left',
      stack: false,
      hidden: false,
    },
  ];
  return {
    type: pi === 0 ? 'line' : 'area',
    mode: 'static',
    shape: 'sine',
    running: false,
    speed: 30,
    win: 600,
    atomic: false,
    xTicks: 8,
    yTicks: 6,
    fontSize: 11,
    gridAlpha: 0.08,
    fixedY: false,
    yMin: 0,
    yMax: 100,
    crossW: 1,
    pointR: 4,
    maxDots: 2000,
    series: base.map((s) => ({ ...s })),
  };
}

// Per-panel config (independent instruments)
export const P = [defaultPanel(0), defaultPanel(1)];

// Live chart instances and their canvases, indexed by panel
export const chart = [null, null];
export const canv = [null, null];

// Per-panel streaming counters/loop handles
export const stream = [
  { t: 0, walk: [], raf: null, last: 0, acc: 0 },
  { t: 0, walk: [], raf: null, last: 0, acc: 0 },
];

// Truly global settings (cross-panel by nature)
export const env = { theme: 'dark', sync: true };
