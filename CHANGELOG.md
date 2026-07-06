# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-07-06

### Behavior fixes

- **Crosshair sync por valor X, não por pixel.**
  Gráficos com tamanhos, margens e domínios diferentes agora sincronizam
  corretamente: o valor de dado é convertido de pixel na origem e de volta
  a pixel no target via pxToX/xToPx. Valor fora do domínio oculta o
  crosshair no target. _(minor, behavior fix)_
- **Stacking separa positivos e negativos.**
  Positivos acumulam num track ascendente, negativos num track descendente,
  sem se cancelarem. Em desenvolvimento, séries do mesmo `stack` com eixos
  ou comprimentos divergentes geram aviso descritivo. _(minor, behavior fix)_
- **`renderedPointCount` renomeado para `windowPointCount`.**
  A métrica antiga mentia: retornava o total de pontos na janela, não os
  efetivamente desenhados (o renderer decima para ~2·plotW colunas no
  regime denso). Agora há duas métricas honestas: `windowPointCount`
  (volume de dados) e `drawnPointCount` (estimativa pós-decimação).
  Quem usava `renderedPointCount` deve migrar para `windowPointCount`.
  _(minor, behavior fix)_

### Added

- `unsync(other)` — remove sincronização bidirecional de crosshair.
- `drawnPointCount` — estimativa de segmentos realmente desenhados após
  decimação (útil para verificar que a decimação está ativa).
- Stacking: validação de alinhamento entre séries do mesmo grupo (eixo e
  comprimento) em desenvolvimento.

### Changed

- `injectCursor` (privado) agora recebe valor X em vez de pixel — alinhado
  com a sincronização por valor. `notifySyncCrosshair` envia valor em vez
  de coordenada de tela.
- `destroy` agora remove o chart de todos os peers sincronizados antes de
  limpar as stores.
- `accumulateStackGroup` retorna `{ posCum, negCum }` separados em vez de
  uma única acumulação líquida.

## [1.1.0] — 2026-07-06

### Behavior fixes

- **`yMin`/`yMax` sentinel: `0` agora é um bound legítimo.**
  Antes `yMin: 0` e `yMax: 0` eram tratados como "auto" (descartados). Agora só
  caem em domínio automático quando `undefined`. `yMin: 0` ancorado é o caso mais
  comum e finalmente funciona. _(minor, behavior fix)_
- **Teclado: navegação por ponto de dado, não por pixel.**
  As setas movem o crosshair de ponto em ponto (lógico) da primeira série
  não-vazia. `Shift+seta` avança 10 pontos. Antes navegava por pixel, sem
  ancorar em dados reais. _(minor, behavior fix)_
- **`prefers-reduced-motion` não para mais o streaming.**
  Antes desligava `autoDraw`, interrompendo o repaint coalescido de dados ao
  vivo. Agora só sinaliza uma flag para suprimir animações visuais (quando
  houverem) sem afetar a atualização contínua do gráfico. _(minor, behavior fix)_

### Changed

- `ResolvedOpts.yMin` / `ResolvedOpts.yMax` agora são `number | undefined`.
  O sentinela "auto" mudou de `0` para `undefined`. Código que dependia do
  comportamento antigo (ex.: checagens `yMin !== 0`) deve usar `yMin !== undefined`.
- `prefers-reduced-motion` adiciona listener `change` em runtime para reavaliar
  a preferência sem recriar o gráfico. O listener é removido em `destroy()`.

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
