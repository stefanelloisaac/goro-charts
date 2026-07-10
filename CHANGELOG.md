# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] — 2026-07-10

### Added

- **Viewport controlável (`setViewport` / `getViewport` / `resetViewport`).**
  Nova API que define uma janela X visível independentemente do domínio
  auto/streaming. Quando ativa, ela é a fonte de verdade de mais alta
  prioridade — curto-circuita `updateGridDomain` antes de qualquer lógica
  de streaming / `fixedY` / grid-pinned. Clamped à extensão de dados;
  uma janela mais larga que os dados equivale a `resetViewport()`. Novo
  evento tipado `viewportchange` emitido em cada mudança (setViewport,
  zoom, pan, reset ou reclamp automático).
- **Zoom por roda (wheel).** Gira o mouse em cima do plot para dar
  zoom-in/out mantendo o ponto sob o cursor ancorado. `deltaY` é
  normalizado por `deltaMode` (linhas × 16px, páginas × 400px), clampado
  em ±500 por evento (evita picos de driver) e composto exponencialmente:
  100 px de scroll ≈ 22 % de zoom. Mesma sensação em mouse coarse e
  touchpad de precisão, sem explodir sob touchpads de alta frequência.
- **Pan por arrastar.** `pointerdown` dentro do plot seguido de
  `pointermove` desloca a janela do viewport, com shift-clamp nas bordas
  (preserva largura ao chegar no extremo). Sinal segue a convenção
  natural: arrastar para a direita revela dados mais antigos.
- **Pinch-to-zoom (dois dedos, touch).** Enquanto exatamente dois
  pointers estão em contato com o canvas, o gesto aplica zoom pela razão
  de distâncias entre eles (ancorado no centroide) e pan pelo movimento
  do centroide. Ao levantar um dedo, faz handoff automático para pan de
  um dedo (`dragging = true`, novo âncora = dedo restante). Crosshair
  fica suprimido durante o pinch. Factor clampado em [0.5, 2] por frame.
- **Auto-scale Y dentro do viewport (`Viewport.yAuto`).** Por padrão
  (`yAuto: true`), quando o viewport está ativo, o eixo Y é reescalado
  para as amostras visíveis dentro de `[xMin, xMax]` — dar zoom num vale
  passa a preencher o plot verticalmente em vez de ficar rente ao pico
  global. Vale tanto para séries não-stacked (min/max dos valores) como
  para stacked groups (acumulação positive/negative por índice, mesma
  regra de `accumulateStackGroup`). `ChartOpts.yMin`/`yMax` ainda ganham.
  Passe `yAuto: false` para manter o comportamento antigo (Y do extent
  full). Preservado entre pans/zooms subsequentes.
- **Pointer Events** substituem os handlers de mouse legados. Mouse,
  caneta e touch entram por `pointermove` / `pointerdown` / `pointerup` /
  `pointercancel` / `pointerleave` unificados. `canvas.style.touchAction =
'none'` desabilita gestos nativos só no canvas — outros elementos da
  página continuam rolando normalmente.
- **Reclamp automático de viewport em streaming.** `append`,
  `appendBatch`, `appendFrame`, `setData`, `setMaxPoints` e `clear`
  chamam `reclampViewportToExtent()` internamente: se a janela ativa
  saiu do extent (ring deslizou, série encolheu, dados limpos), aplica
  shift-clamp preservando largura; se ficou mais larga que o extent,
  faz reset; se ficou sem dados, libera o viewport. Emite
  `viewportchange` só quando a janela realmente moveu.
- 2 testes de pinch (spread → zoom-in; handoff pinch→pan preserva
  `dragging`).

### Fixed

- **Vazamento de séries para fora do plot rect.** Antes, sem
  `ctx.clip()`, uma janela de viewport estreita gerava `xScale` gigante
  e projetava amostras fora do domínio para pixels bem além do plot rect
  — o Canvas 2D desenhava esses `lineTo` livremente por cima dos labels
  do eixo e nos cantos. `renderStatic` agora envolve séries + legenda
  com `save() / rect(plot) / clip() / restore()`. Grid e axes ficam
  FORA do clip (labels precisam desenhar na área de padding), então
  nada quebra visualmente.
- **Zoom sem repaint até o próximo pointermove.** Sob `autoDraw: false`
  (default), `invalidate('layout')` só marcava dirty e nunca agendava
  rAF, então o pixel do zoom só surgia no próximo evento de mouse.
  `onWheel` agora chama `scheduleInteractionFrame()` que faz o repaint
  no próximo rAF.
- **`onPointerLeave` durante pinch** — a guard só protegia `dragging`;
  agora também checa `pinching`, para o crosshair não ser escondido no
  meio de um gesto de dois dedos que cruza a borda do canvas.

### Performance

- **Windowed rendering (`math/window.ts`).** Novo helper
  `resolveRenderWindow(view, xMin, xMax)` binary-searches
  `view.bracketLogical` para bracketar o intervalo lógico visível (+1
  amostra de contexto em cada borda para segmentos de entrada/saída).
  `renderLine`, `renderArea`, `renderScatter` e `renderStackedBands`
  agora iteram `[iStart, iEnd]` em vez de `[0, count)`. Numa série de
  500k pontos com zoom em 1 % da largura, o rendering passa de O(500k)
  para O(~5k) por série por frame. Fallback seguro para xRange = 0
  (série de 1 ponto) e domínio não-finito.
- **rAF-coalescing de interação.** Bursts de wheel (touchpads emitem
  60–120 eventos/s) e `pointermove` (até 240 Hz em alguns dispositivos)
  agora colapsam em 1 draw por frame via `interactionRafId` (separado
  do `rafScheduled` do autoDraw). Estado (viewport, cursor, dragging)
  ainda muta síncrono — `getViewport()` reflete a interação
  imediatamente; só o repaint é coalescido.
- **Pool de views (`PooledView`).** Duas pools de instâncias reutilizáveis
  substituem o `Object.assign(Object.create(prototype), …)` por série
  por frame: `viewSlotRender` (1 slot para `renderOne`) e
  `viewPoolCrosshair[N]` (um slot por série para `buildCrosshairViews`).
  A classe delega `physOf`/`bracketLogical` para o store bound, então
  ring wraparound continua correto. Elimina ~360 alocações/s em gestos
  com 3 séries + crosshair.
- **Cache do bounding rect.** `Surface.clientRect()` cacheia a posição
  do canvas em CSS pixels; `Surface.invalidateClientRect()` é chamado
  pelo `handleWindowLayoutShift` (novo listener `scroll` com
  `capture: true` + `resize` na window, ambos passivos), invalidando em
  qualquer scroll ancestral. Handlers `onPointerMove` / `onPointerDown`
  / `onWheel` deixaram de chamar `getBoundingClientRect()` a cada
  evento — remove um layout-forcer do hot path.

### Changed

- `Viewport` ganhou o campo opcional `yAuto?: boolean` (default `true`).
  `null | undefined` em `getViewport()` continua significando "sem
  viewport".
- Comportamento do zoom por wheel: uma volta grande do scroll agora dá
  um zoom maior (composição exponencial em vez de fator fixo de 1.1
  por evento) — o feel é diferente, mas o sentido (deltaY > 0 = zoom
  out) e a semântica de teste (`getViewport()` reflete o efeito
  sincronamente) foram preservados.

### Notes

- **Semver.** Minor. API adicional, sem quebra: `Viewport.yAuto` é
  opcional, o comportamento antigo (Y do extent full) é acessível via
  `yAuto: false`. Consumidores que já usavam `setViewport({ xMin, xMax })`
  passam automaticamente a ter auto-Y — visualmente diferente do v1.6.0,
  mas dentro do escopo aditivo da fase.
- **Escopo v1.7.0.** Todos os critérios de aceite em
  `docs/phases/v1.7.0-viewport-zoom-pan.md` estão cobertos, incluindo os
  extras de pinch e auto-Y (que a fase original marcava como "Y fora de
  escopo" — vieram junto pois o diagnóstico revelou que sem eles o
  zoom não parecia responder).

## [1.6.0] — 2026-07-09

### Fixed

- **`formatTimeTick` inconsistente entre locales.** O formatador interno de
  eixo temporal usava `Intl.DateTimeFormat(undefined, …)`, que delega o
  ciclo horário (12h vs 24h) ao locale do _host_ — `en-US` produzia
  `'02:30 PM'` em vez de `'14:30'`, quebrando 3 testes no CI. Adicionado
  `hourCycle: 'h23'` às opções de `ms`/`second`/`minute`/`hour` para
  forçar saída 24h determinística.

### Added

- **Time axis.** `xAxis: { type: 'time' }` treats X values as epoch
  milliseconds and generates calendar-aware ticks (second → minute → hour →
  day/week → month/quarter → year) instead of arbitrary linear divisions.
  Fixed-ms tiers are used up to ~2 weeks per tick; coarser spans walk real
  UTC calendar boundaries (month/quarter/year) so labels never drift.
  `xAxis.timeZone` forwards to the built-in default time formatter only.
- **Formatters.** `xAxis.tickFormat`, `yAxis.tickFormat`, `tooltip.xFormat`,
  `tooltip.valueFormat`, and `SeriesConfig.valueFormat` let axis labels and
  the crosshair tooltip render custom string representations without ever
  mutating the underlying numeric value. Tooltip value precedence:
  `SeriesConfig.valueFormat` → `ChartOpts.tooltip.valueFormat` → the
  built-in default.
- **`gapMode` (missing data).** `ChartOpts.gapMode` (chart-wide default) and
  `SeriesConfig.gapMode` (per-series override, takes precedence) control how
  a `NaN` Y sample renders: `'break'` (default) lifts the pen so no line or
  fill crosses the gap; `'connect'` skips the missing sample so its valid
  neighbours join directly; `'zero'` treats it as `0` for rendering only —
  the stored data is never mutated. Implemented across `LineChart`,
  `AreaChart` (sparse + decimated regimes, and its stacked-band path), and
  `ScatterChart`.
- New public types: `ScaleType`, `GapMode`, `XAxisConfig`, `YAxisConfig`,
  `TooltipConfig`. `ScaleType` is `'linear' | 'time' | 'band'` — `'band'` is
  recognised and accepted by the type system (reserved for the v1.9.0 bar
  chart); using it at runtime throws a descriptive error until the
  implementation lands.

### Fixed

- **Stacked-area NaN poisoning.** A `NaN` sample in one layer of a stacked
  group no longer corrupts every later cumulative value for the rest of the
  series (`running[j] += NaN` previously propagated `NaN` forward
  indefinitely once a gap occurred). A gap sample now contributes `0` to its
  layer's cumulative sum at that index — the documented stacking-gap
  contract.

## [1.5.0] — 2026-07-07

### Added

- **`appendFrame(x, values)`.** Atomically append one sample per series in a
  single frame. Accepts `Map<SeriesRef, number>` or `Record<string, number>`.
  Series absent from the frame receive a carry-forward of their last `y` so
  every active series stays ring-aligned frame-by-frame (including hidden
  series). Validation runs on the entire frame before any series is mutated,
  so a failing frame leaves every series unchanged.
- **Typed events.** `on(type, fn)` / `off(type, fn)` for chart lifecycle and
  streaming events. `frameappended` fires after each frame; `destroy` fires
  once before listeners are cleaned up. Listeners are typed and removable.
- **Invalidation model.** Dirty flags now separate layout/data changes
  (`dirtyLayout`) from visual-only changes (`dirtyPaint`). `setOptions` and
  internal mutations choose the cheapest invalidation: a colour change
  repaints without recomputing the grid domain. The draw routine only
  re-runs `updateGridDomain()` when `dirtyLayout` is true.
- **`makeView` unified.** The proxy-view construction that was duplicated in
  `renderOne` and `buildCrosshairViews` is now a single private `makeView`
  method, ready for the v1.7.0 viewport.
- Types `ChartFrameValues`, `ChartEventMap`, `ChartEventType`,
  `ChartEventListener`, `FrameAppendedEvent`, and `ChartDestroyedEvent` are
  exported from the package entry point.

### Changed

- `appendFrame` API changed from `Map<SeriesRef, { x, y }>` to
  `appendFrame(x: number, values: ChartFrameValues)` — a single `x` plus
  ref→y map, matching the documented vision. _(breaking change for any early
  adopter of the original signature; the old `ChartFrame` / `ChartFramePoint`
  types are removed.)_
- `destroy()` emits the `'destroy'` event **before** setting `destroyed=true`
  and clearing listeners, so destroy listeners actually fire.
- Canvas resize handler (`onResize`) now sets `dirtyLayout = true` directly
  instead of calling `invalidate()`, matching the layout/paint separation.

## [1.4.0] — 2026-07-07

### Behavior fixes

- **Crosshair sync into stacked AreaChart now works both ways.**
  Syncing a `LineChart` into a stacked `AreaChart` (and vice-versa) previously
  failed for the stacked target: the injected crosshair either read the wrong
  value or drew nothing. `buildCrosshairViews` now builds the cumulative `yArr`
  in **physical layout** (length = `cap`), so `computeHits` addresses it through
  `physOf` correctly even after the ring buffer wraps (`head !== 0`).
  _(minor, behavior fix)_
- **Injected `cursorY` is clamped to the plot rect.**
  A synced crosshair whose derived Y fell outside the plot bounds made
  `renderCrosshair` bail silently, so the target chart showed no line. The
  injected `cursorY` is now clamped to `[plot.y, plot.y + plot.h]`.
  _(minor, behavior fix)_
- **Stacked crosshair dots align with the drawn bands.**
  The crosshair accumulation now mirrors `renderStackedBands` (running sum in
  draw order) instead of the split positive/negative tracks, so the marker dots
  sit on the real band edges. _(minor, behavior fix)_
- **`onHover([])` fires on leave.**
  Leaving a chart (directly or via a synced peer) now emits an empty hover so
  external tooltips can clear their state, instead of keeping the last values.
  _(minor, behavior fix)_

### Added

- **Series ids.** Every series may declare a stable `id`. All data and metric
  methods now accept a `SeriesRef` (`number | string`) — the numeric index or
  the id. Duplicate ids are rejected at construction and by `addSeries`; error
  messages quote the offending id.
- **`setOptions(patch)`.** Update options at runtime without recreating the
  chart. Visual keys (colours, font, crosshair, tick counts) repaint only;
  structural keys (`series`, `padding`, `yMin`/`yMax`, `maxPoints`) reflow the
  layout and re-anchor the grid.
- **Add / remove / show / hide series.** `addSeries(config)` (returns the new
  index), `removeSeries(ref)`, `showSeries(ref)`, `hideSeries(ref)`. A hidden
  series is excluded from rendering, the grid domain, and the crosshair — as if
  it had no data.
- **`batch(fn)`.** Groups several mutations into a single repaint, resuming the
  draw scheduler even if the callback throws.
- `SeriesConfig.id`, `SeriesConfig.hidden`, and the `SeriesRef` / `ChartOptionsPatch`
  types are exported from the package entry point.

### Changed

- Data and metric method signatures take `ref: SeriesRef` instead of
  `index: number` (index calls remain valid — `number` is part of `SeriesRef`).
- Demo simplified: charts are created directly (`new LineChart(...)`) with the
  panels/metrics/format helpers removed, and the DOM hover strip was dropped
  from `index.html` in favour of the on-canvas crosshair tooltip.

## [1.3.0] — 2026-07-06

### Behavior fixes

- **Data ownership contract (`copy`/`borrowed`).**
  `setData` now **copies** the arrays by default (`'copy'`), making the chart
  immune to external mutation. The `'borrowed'` (zero-copy) mode is available
  as an opt-in but requires the caller to treat the arrays as immutable.
  _(minor, behavior fix — the default semantics changed from borrowed to copy)_
- **Numeric input validation.**
  Length mismatches, non-monotonic X, non-finite X (`Infinity`, `-Infinity`,
  `NaN`), and non-finite Y (`±Infinity`) are now rejected with a descriptive
  error naming the series and position — the same contract applies both in
  snapshot mode (`setData`) and in streaming mode (`append`/`appendBatch`).
  `NaN` in Y is the only accepted exception (see below). Inputs previously
  accepted silently (or only with a `console.warn`) now throw.
  _(minor, behavior fix)_
- **Non-monotonic append now throws.**
  The previous `console.warn` was promoted to a thrown error to fail fast.
  `appendBatch` validates the entire batch before pushing any sample — partial
  batches never corrupt the ring state. _(minor, behavior fix)_
- **NaN in Y accepted and documented.**
  `NaN` in Y is accepted, excluded from the extent computation, and reserved
  for gap rendering in v1.6.0. Arrays where every Y is `NaN` produce a safe
  degenerate range. _(minor, behavior fix)_

### Added

- `DataOwnership = 'copy' | 'borrowed'` type and the optional `ownership`
  parameter on `setData(index, x, y, ownership?)`.
- `npm run check:readme` script — extracts every `ts` block from the README
  and typechecks it against the real exported types. Wired into CI.
- New `Check README examples` CI step (before Typecheck).
- Reserved (commented-out TODO) slot for `docs/assets/streaming.gif` in the
  README's first fold — the `![…]` stays commented until the asset exists, so
  a broken image is never published.

### Changed

- `setData(index, x, y)` now takes an optional fourth argument `ownership`
  (default `'copy'`).
- README signature-reference blocks (e.g. `new LineChart(canvas, opts?:
ChartOpts)`) are marked with `// signature` and skipped by `check:readme`,
  keeping the readable form without breaking the semantic checking of the
  runnable examples.

## [1.2.0] — 2026-07-06

### Behavior fixes

- **Crosshair sync by X value, not by pixel.**
  Charts with different sizes, margins, and domains now sync correctly: the
  data value is converted from pixel at the origin and back to pixel at the
  target via pxToX/xToPx. A value outside the domain hides the crosshair on
  the target. _(minor, behavior fix)_
- **Stacking separates positives and negatives.**
  Positives accumulate on an ascending track, negatives on a descending track,
  without cancelling each other out. In development, series in the same `stack`
  with divergent axes or lengths emit a descriptive warning.
  _(minor, behavior fix)_
- **`renderedPointCount` renamed to `windowPointCount`.**
  The old metric lied: it returned the total points in the window, not those
  actually drawn (the renderer decimates to ~2·plotW columns in the dense
  regime). There are now two honest metrics: `windowPointCount` (data volume)
  and `drawnPointCount` (post-decimation estimate). Anyone using
  `renderedPointCount` should migrate to `windowPointCount`.
  _(minor, behavior fix)_

### Added

- `unsync(other)` — removes bidirectional crosshair synchronization.
- `drawnPointCount` — estimate of segments actually drawn after decimation
  (useful to verify that decimation is active).
- Stacking: alignment validation between series in the same group (axis and
  length) in development.

### Changed

- `injectCursor` (private) now receives an X value instead of a pixel —
  aligned with value-based sync. `notifySyncCrosshair` sends a value instead
  of a screen coordinate.
- `destroy` now removes the chart from all synced peers before clearing the
  stores.
- `accumulateStackGroup` returns separate `{ posCum, negCum }` instead of a
  single net accumulation.

## [1.1.0] — 2026-07-06

### Behavior fixes

- **`yMin`/`yMax` sentinel: `0` is now a legitimate bound.**
  Previously `yMin: 0` and `yMax: 0` were treated as "auto" (discarded). They
  now fall back to an automatic domain only when `undefined`. An anchored
  `yMin: 0` is the most common case and finally works. _(minor, behavior fix)_
- **Keyboard: navigation by data point, not by pixel.**
  The arrow keys move the crosshair point by point (logical) across the first
  non-empty series. `Shift+arrow` advances 10 points. It previously navigated
  by pixel, without anchoring to real data. _(minor, behavior fix)_
- **`prefers-reduced-motion` no longer stops streaming.**
  It previously turned off `autoDraw`, interrupting the coalesced repaint of
  live data. It now only sets a flag to suppress visual animations (when
  present) without affecting the chart's continuous updates.
  _(minor, behavior fix)_

### Changed

- `ResolvedOpts.yMin` / `ResolvedOpts.yMax` are now `number | undefined`.
  The "auto" sentinel changed from `0` to `undefined`. Code that relied on the
  old behavior (e.g. `yMin !== 0` checks) should use `yMin !== undefined`.
- `prefers-reduced-motion` adds a runtime `change` listener to re-evaluate the
  preference without recreating the chart. The listener is removed in
  `destroy()`.

## [1.0.0]

Initial stable release.

### Added

- **LineChart** — batched polyline with per-pixel-column min/max decimation.
- **AreaChart** — filled region below the line, same decimation path, separate fill/stroke.
- **ScatterChart** — stride-thinned scatter plot, one circle per sampled point.
- **Multi-series** — one chart, many series, each with its own colour, width, fill, dash, and Y-axis.
- **Dual Y-axis** — independent left and right domains, per-series axis assignment.
- **Stacked area** — series sharing a `stack` id render cumulatively (AreaChart),
  with the same per-pixel-column decimation as line/area so large windows stay
  cheap (flat draw cost regardless of window size).
- **Fixed Y range** — lock the grid globally with `yMin`/`yMax`, or per-series overrides.
- **Streaming ring mode** — O(1) append and O(1) sliding-window min/max via monotonic
  deques. The grid Y domain tracks the sliding window (grows and shrinks) so bands
  never drift past the frame; snapshot mode keeps the expand-only anchor.
- **Snapshot mode** — full-series replacement via `setData` with columnar `Float64Array` data.
- **Crosshair** — multi-series interpolated tooltip card, keyboard navigation, chart-to-chart sync.
- **Accessibility** — `role="img"`, dynamic `aria-label`, `aria-live` announcements,
  `prefers-reduced-motion`, `prefers-contrast`, and `forced-colors` support.
- **Rendering** — `devicePixelRatio`-aware, offscreen static layer with 1:1 blit,
  `ResizeObserver` auto-sizing, `rAF`-coalesced auto-draw.
- **DARK** / **LIGHT** colour presets.
- **PNG export** via `toImage()`.
