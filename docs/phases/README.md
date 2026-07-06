# Goro Charts — Roadmap por versão

> Índice das fases de implementação, fatiadas em versões minor publicáveis.
>
> Estes arquivos **resumem** e **anexam** os três documentos de direção sem
> alterá-los. As fontes continuam sendo:
>
> - [`../vision.md`](../vision.md) — direção de produto e foco técnico
> - [`../improvements.md`](../improvements.md) — plano operacional (P0–P3, §14 fases, §15 ordem exata, §16 DoD, §17 estável)
> - [`../addons.md`](../addons.md) — adendos e cautelas de código
>
> Foco travado: **live and large XY data**. Nada aqui expande o escopo além disso.

---

## Regra de versionamento

A biblioteca está em `1.0.0`, mas as correções da primeira fase alteram
comportamento incorreto (ex.: `yMin: 0` descartado). Na prática, tratamos o
estado atual como **pré-estável**:

- **Cada fase → uma versão minor** (`1.1.0`, `1.2.0`, …).
- Correções que alteram comportamento entram como **minor** com nota explícita
  `behavior fix` no `CHANGELOG.md` — não como major.
- O objetivo é **evitar quebras grandes por release**: cada minor é pequeno,
  focado e reversível.
- O portão para uma eventual `2.0.0` estável é a
  [Definition of Done](#definition-of-done-portão-para-estável) no fim deste arquivo.

---

## Sequência de versões

| Versão                                  | Fase origem | Tema                                                         | Prioridade | Risco    |
| --------------------------------------- | ----------- | ------------------------------------------------------------ | ---------- | -------- |
| [1.1.0](./v1.1.0-correcoes-criticas.md) | Fase 1      | Correções P0: `yMin`/`yMax`, teclado, reduced-motion         | P0         | baixo    |
| [1.2.0](./v1.2.0-crosshair-metricas.md) | Fase 1      | Crosshair sync por valor, `unsync`, stacking, métricas       | P0         | baixo    |
| [1.3.0](./v1.3.0-contratos-dados.md)    | Fase 1      | README no CI, ownership de arrays, validação de dados        | P0         | baixo    |
| [1.4.0](./v1.4.0-api-series.md)         | Fase 2      | IDs de série, `setOptions`, add/remove/show-hide, batch      | P1         | baixo    |
| [1.5.0](./v1.5.0-streaming-eventos.md)  | Fase 2      | `appendFrame`, eventos tipados, modelo de invalidação        | P1         | médio    |
| [1.6.0](./v1.6.0-eixo-temporal.md)      | Fase 3      | Eixo temporal, formatadores, dados ausentes, escala plugável | P1         | médio    |
| [1.7.0](./v1.7.0-viewport-zoom-pan.md)  | Fase 3      | Viewport, zoom, pan, Pointer Events, touch                   | P1         | **alto** |
| [1.8.0](./v1.8.0-performance.md)        | Fase 4      | Benchmarks reais, Playwright, uPlot, bundle budget           | —          | médio    |
| [1.9.0](./v1.9.0-expansao.md)           | Fase 5      | Bar chart, anotações, subpath exports, CSV                   | P2         | médio    |

---

## Rastreabilidade — ordem exata (improvements §15)

Todos os 26 passos da "ordem exata recomendada de implementação" estão cobertos.
Cada passo aparece em exatamente uma versão.

| # §15 | Passo                                 | Versão |
| ----- | ------------------------------------- | ------ |
| 1     | Corrigir `yMin` e `yMax`              | 1.1.0  |
| 2     | Corrigir keyboard navigation          | 1.1.0  |
| 3     | Corrigir reduced motion               | 1.1.0  |
| 4     | Refatorar crosshair sync para valor X | 1.2.0  |
| 5     | Criar `unsync` e limpeza em `destroy` | 1.2.0  |
| 6     | Corrigir stacking                     | 1.2.0  |
| 7     | Corrigir métricas                     | 1.2.0  |
| 8     | Compilar exemplos do README no CI     | 1.3.0  |
| 9     | Definir ownership dos arrays          | 1.3.0  |
| 10    | Definir validação e gaps              | 1.3.0  |
| 11    | Introduzir IDs de série               | 1.4.0  |
| 12    | Criar `setOptions`                    | 1.4.0  |
| 13    | Criar atualização dinâmica de séries  | 1.4.0  |
| 14    | Criar batch                           | 1.4.0  |
| 15    | Criar `appendFrame`                   | 1.5.0  |
| 16    | Implementar eixo temporal             | 1.6.0  |
| 17    | Implementar formatadores              | 1.6.0  |
| 18    | Implementar viewport                  | 1.7.0  |
| 19    | Implementar zoom                      | 1.7.0  |
| 20    | Implementar pan                       | 1.7.0  |
| 21    | Migrar para Pointer Events            | 1.7.0  |
| 22    | Criar testes Playwright               | 1.8.0  |
| 23    | Refazer benchmarks                    | 1.8.0  |
| 24    | Criar comparação com uPlot            | 1.8.0  |
| 25    | Implementar bar chart                 | 1.9.0  |
| 26    | Implementar anotações                 | 1.9.0  |

---

## Cautelas de código (addons §2) — pré-requisitos cruzados

Duas refatorações preventivas evitam gambiarra nas fases de interação:

- **Extrair `makeView()`** (addons §2.2) — a "proxy view"
  (`Object.assign(Object.create(getPrototypeOf(store)), store, {...})`) está
  duplicada em `src/charts/chart-base.ts` (L466 e L614). Unificar num único
  `makeView(store, domain, overrides)` **em 1.5.0**, antes do zoom.
- **Viewport curto-circuita `updateGridDomain`** (addons §2.1) — se existe
  viewport do usuário, ele ganha na entrada de `updateGridDomain`
  (`src/charts/chart-base.ts:730`) e a função retorna, sem passar por streaming /
  `fixedY` / `gridPinned`. Requisito de **1.7.0**.

---

## Escopo descartado conscientemente (addons §3)

Não reabrir nas fases abaixo:

| Ideia descartada                              | Motivo                               |
| --------------------------------------------- | ------------------------------------ |
| Sistema de plugins                            | Prematuro; trava a evolução do core  |
| Sistema de temas extenso                      | Fora do foco                         |
| Pizza, donut, radar, funil, gauge, mapas      | Não são XY                           |
| "Escala plugável abre qualquer gráfico"       | Serve só p/ time + band dentro de XY |
| Carregamento assíncrono/virtualizado de dados | Responsabilidade da aplicação        |

> OHLC/candlestick **não** está descartado — é XY e consta como futuro.

---

## Definition of Done (portão para estável)

Referência: improvements §16 e §17. Uma versão só é considerada "pronta" quando:

**Código**

- Sem comportamento incorreto conhecido; tipos, README e código alinhados.

**Testes**

- Unitários para o contrato alterado; integração em navegador quando toca render/interação.

**Documentação**

- Exemplos do README compilam no CI; contratos documentados.

**Performance**

- Alterações sensíveis a performance têm benchmark reproduzível e bundle budget respeitado.

**Acessibilidade**

- Navegação por teclado e reduced-motion funcionam onde aplicável.

Uma **1.0 estável de fato** (improvements §17) exige: correções P0 concluídas,
API estável (IDs, batch, `appendFrame`), eixo temporal + viewport, e benchmarks
reais publicados — ou seja, até **1.8.0** consolidada.

---

_Documentos vivos. Anexam-se aos três planos principais sem alterá-los._
