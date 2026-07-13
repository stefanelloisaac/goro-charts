# AGENTS.md — goro-charts

Guia operacional para agentes trabalhando neste repositório.

Goro Charts é uma biblioteca TypeScript, framework-agnostic, sem dependências de
runtime, para gráficos XY em Canvas 2D. O pacote público sai de `src/index.ts`.

## Comandos

Requer **Node >= 24**.

Scripts principais:

| Script                  | Uso                                                     |
| ----------------------- | ------------------------------------------------------- |
| `npm run dev`           | Vite dev server para `index.html` + `demo/`.            |
| `npm run build`         | Build da lib (`vite build` + `.d.ts` + fix de imports). |
| `npm run build:demo`    | Build do demo estático em `dist-demo/`.                 |
| `npm run lint`          | ESLint do repo.                                         |
| `npm run check:readme`  | Typecheck dos blocos TypeScript do README.              |
| `npm run typecheck`     | `tsc -b`.                                               |
| `npm run test`          | Vitest single run.                                      |
| `npm run test:coverage` | Vitest com coverage.                                    |
| `npm run size`          | Size-limit, bloqueante na CI.                           |
| `npm run bench`         | Benchmark local; espera `dist/` pronto.                 |
| `npm run fix:all`       | ESLint fix + Prettier.                                  |

CI roda, nesta ordem:

```txt
lint -> check:readme -> typecheck -> test -> build -> size
```

Antes de finalizar mudança de código, prefira verificar nessa ordem. Para docs
puros, `check:readme` só é necessário se o README mudar.

## Layout

```txt
src/
  index.ts          única entrada pública
  types.ts          tipos públicos e internos
  defaults.ts       defaults de opções
  presets.ts        presets DARK/LIGHT
  charts/           LineChart, AreaChart, ScatterChart e ChartBase
  data/             SeriesStore, RingBuffer, MonotonicExtent
  render/           renderers Canvas 2D puros + Surface
  math/             escala, ticks, cache de ticks, formatação, janela visível
demo/               demo estático
docs/
  vision.md         visão canônica de produto
  phases/           planos futuros de implementação
scripts/            build/readme/bench helpers
```

## Arquitetura atual

- **Camadas:** `charts/` orquestra; `data/` guarda dados; `render/` desenha;
  `math/` calcula escala, ticks e janelas.
- **Superfície pública:** consumidores importam apenas de `src/index.ts`. Se uma
  API nova deve ser pública, exporte por ali.
- **Data modes:**
  - snapshot: `setData`, com `ownership: 'copy' | 'borrowed'`;
  - ring/streaming: ativado por `maxPoints > 0`, usado por `append`,
    `appendBatch`, `appendFrame`.
- **`maxPoints: 0` significa snapshot**, não “ilimitado”.
- **Renderers são puros:** funções em `render/` não possuem estado, não agendam
  frame e não acessam stores diretamente; elas recebem views/opts/plot/context.

## Pipeline de draw

O pipeline atual usa camadas separadas:

1. atualizar domínio quando `dirtyDomain` estiver ativo;
2. renderizar **frame layer** quando `dirtyFrame` estiver ativo;
3. renderizar **series layer** quando `dirtySeries` estiver ativo;
4. compor frame + series no canvas visível;
5. renderizar overlay/crosshair quando `dirtyOverlay` ou `showCrosshair` exigir.

Camadas:

- **Frame layer:** background, grid, axes, labels e legend.
- **Series layer:** caminhos clipados das séries. É condicional: só existe em
  ring/streaming (`maxPoints > 0`).
- **Canvas visível:** composição das camadas + overlay.

Dirty flags atuais:

- `dirtyDomain` — domínio precisa ser recomputado;
- `dirtyFrame` — frame layer precisa redesenhar;
- `dirtySeries` — séries precisam redesenhar;
- `dirtyOverlay` — overlay/crosshair precisa recompor.

Não reintroduza os flags legados de layout/paint.

## Regras importantes de implementação

- Preserve a arquitetura existente. Prefira mudanças pequenas, locais e
  reversíveis.
- Não adicione dependência de runtime sem necessidade explícita.
- Não crie nova arquitetura se uma correção local resolve.
- Mantenha imports relativos com extensão `.ts`.
- Use `import type` para imports somente de tipo.
- Preserve loops quentes dos renderers; não troque aritmética inline por helpers
  frios (`xToPx`, `yToPx`) dentro de hot paths.
- Evite alocar objetos no hot path de render/crosshair. Reuse pools/views
  existentes.
- `Surface.clientRect()` é cacheado; use ele em eventos de ponteiro/roda em vez
  de chamar `canvas.getBoundingClientRect()` diretamente.
- `destroy()` deve continuar idempotente.

## Séries, domínio e viewport

- `SeriesRef` aceita índice numérico ou `SeriesConfig.id`.
- Stacking usa `SeriesConfig.stack`.
- Dual-Y usa `SeriesConfig.yAxis: 'right'`.
- `setViewport({ xMin, xMax, yAuto? })` tem prioridade sobre domínio automático,
  streaming e grid pinned.
- Não mova o short-circuit de viewport para dentro de branches menores em
  `updateGridDomain`; viewport precisa vencer sempre.
- `yAuto` default é `true` quando viewport está ativo.
- Streaming não limpa viewport; ele reclampa para não deixar a janela fora dos
  dados.

## Interação

- Handlers de wheel/pointer mutam estado de forma síncrona.
- Repaint de interação é coalescido por rAF.
- Testes podem ler estado imediatamente após o evento, mas pixels só mudam após
  `draw()` ou rAF.
- `sync` compartilha crosshair, não domínio/viewport.

## Documentação

Política atual:

- `docs/vision.md` é a visão canônica de produto. Não deve virar plano técnico.
- `docs/phases/*` contém planos futuros de implementação. Devem ser
  autossuficientes.
- Não recrie docs apagados.
- Não trate docs antigos/deletados como fonte de verdade.
- Se documentação e código divergirem, inspecione o código antes de agir.
- Mudanças de direção de produto pertencem ao `vision.md`.
- Mudanças técnicas planejadas pertencem a `docs/phases/`.

Docs restantes esperados:

```txt
docs/vision.md
docs/phases/v1.9.0-performance-pendencias.md
docs/phases/v2.0.0-api-ergonomics.md
docs/phases/v2.1.0-expansao.md
```

## Testes

- Testes ficam em `src/**/__tests__/*.test.ts`.
- Vitest usa `happy-dom` e setup em `src/__setup.ts`.
- Para renderers, prefira `src/render/__tests__/ctx-mock.ts` e assert de
  comandos Canvas, não pixel output.
- README examples são validados por `npm run check:readme`.
- Ao alterar render/interação, cubra estados de viewport, dual-Y, stacked,
  gaps, clip, DPR e crosshair quando relevante.

## Gotchas atuais

- `ownership: 'borrowed'` compartilha arrays; o caller não pode mutá-los depois
  de `setData`.
- `gapMode`: `'break'`, `'connect'`, `'zero'`; per-series vence chart-wide.
- `xAxis.type: 'time'` usa epoch-ms linear; a diferença está em ticks/labels.
- `formatTimeTick` usa `hourCycle: 'h23'` para estabilidade entre locales.
- `xAxis.type: 'band'` é preparatório para expansão XY/bar chart; não force uso
  em renderers que ainda não suportam band.
- Series são clipadas ao plot; grid/axes ficam fora do clip.
- Legend está na frame layer; mudanças de série que afetam legenda podem exigir
  `dirtyFrame` além de `dirtySeries`.
- Bundle budget é CI-blocking (`npm run size`).

## Git e release

- Não faça commit, tag, push ou release sem pedido explícito.
- Não use comandos destrutivos de git.
- Antes de qualquer commit solicitado, revise `git status`, `git diff` e inclua
  somente arquivos intencionais.
