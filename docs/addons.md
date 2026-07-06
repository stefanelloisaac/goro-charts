# Goro Charts — Adendos ao plano

> Complemento curto aos documentos **Foco e direção** e **Plano de melhorias**.
> Não repete nada que já está neles. Reúne só os poucos pontos que ainda agregam,
> mais duas cautelas de código e uma lista do que descartar conscientemente.
>
> Tudo aqui respeita o foco definido: _live and large XY data_.

---

## 1. Itens que ainda agregam (não estão nos outros docs)

### 1.1 GIF/vídeo do streaming no topo do README

Nenhum dos dois planos menciona. É barato e é o que mais converte numa lib de
gráfico — ainda mais quando o diferencial é streaming ao vivo. Um GIF curto
mostrando dados chegando em tempo real vale mais que qualquer parágrafo.

- **Onde:** README, primeira dobra (complementa melhorias §10.1).
- **Esforço:** baixo. **Impacto:** adoção.

### 1.2 OffscreenCanvas + Web Worker (longo prazo)

Os planos deprioritizam WebGL — correto. Mas OffscreenCanvas + Worker é outra
coisa: move o render pra fora da thread principal, servindo direto ao Pilar 1
(streaming) e ao Cenário D (100 Hz). Não aparece em nenhum dos dois.

- **Quando:** Fase 4/5, **depois** da medição real de performance. Nunca antes.
- **Cuidado:** toca `render/surface.ts` e o caminho de draw inteiro. É um projeto,
  não um ajuste. Só faz sentido se o benchmark provar que a thread principal é o
  gargalo.
- **Esforço:** alto. **Impacto:** alto no nicho de alta frequência.

### 1.3 Band scale nomeada como conceito em `math/scale.ts`

O eixo temporal (melhorias §6.1) e o bar chart (melhorias §7.1) estão descritos
como itens separados. Na prática, os dois se apoiam na **mesma peça**: um
`scale.ts` que aceita mais de um tipo de escala.

Hoje `scale.ts` só sabe fazer `linear`. Ao implementar o eixo temporal (Fase 3),
já deixar a escala plugável:

- `linear` — já existe, vira uma das opções
- `time` — destrava o eixo temporal
- `band` — destrava o bar chart quase de graça na Fase 5

Assim o bar chart não vira uma segunda batalha de escala — ele reaproveita a
fundação já pronta.

- **Importante:** essa escala serve **só** para time + band dentro de XY. Não é
  uma porta para pizza, radar ou mapas — esses continuam fora do foco.
- **Esforço:** médio (feito junto com o eixo temporal). **Impacto:** economia de
  retrabalho na Fase 5.

### 1.4 Export CSV dos dados visíveis

A lib já tem `toImage()`. Exportar os dados dentro do viewport atual em CSV
encaixa no Pilar 2 (exploração de histórico), sem virar responsabilidade de
ingestão (que continua da aplicação).

- **Onde:** utilitário novo consumindo o `SeriesView` + viewport.
- **Esforço:** baixo. **Impacto:** médio. **Prioridade:** opcional.

---

## 2. Cautelas de código (complementam a arquitetura dos outros docs)

Observações vindas da leitura do código atual, à luz do zoom/pan planejado.

### 2.1 Viewport deve curto-circuitar no topo de `updateGridDomain`

O `updateGridDomain` já tem três caminhos entrelaçados: streaming, `fixedY` e
`gridPinned`. O viewport do usuário (zoom/pan) é uma **quarta fonte de verdade** e
não pode virar mais um `if` no meio dessa função.

Regra: **se existe viewport do usuário, ele ganha logo na entrada da função e ela
retorna** — sem passar pelos outros três caminhos. Isso mantém a lógica de
streaming intacta e reforça, num ponto concreto, a separação
dados/layout/render de melhorias §12.1.

### 2.2 Extrair `makeView()` antes de implementar zoom

A construção da "proxy view"
(`Object.assign(Object.create(getPrototypeOf(store)), store, {...})`) está hoje
**duplicada** em `renderOne` e no crosshair. O zoom vai precisar da mesma
construção com o domínio do viewport.

Unificar isso num único método `makeView(store, domain, overrides)` **antes** de
começar o zoom evita triplicar o padrão. Casa com a intenção de melhorias §12.2
(evitar `ChartBase` monolítico) e reduz o risco de virar gambiarra.

---

## 3. Descartar conscientemente

Ideias que já foram cogitadas antes e que o foco atual **mata**. Registradas aqui
só para não voltarem por engano.

| Ideia descartada                              | Motivo                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| Sistema de plugins                            | Prematuro; trava a evolução do core (melhorias §2.3) |
| Sistema de temas extenso                      | Fora do foco (melhorias §2.3)                        |
| Pizza, donut, radar, funil, gauge, mapas      | Não são XY; fora do recorte (foco §10)               |
| "Escala plugável abre qualquer gráfico"       | Errado: serve só p/ time + band dentro de XY         |
| Carregamento assíncrono/virtualizado de dados | Responsabilidade da aplicação, não da lib (foco §11) |

> Nota: OHLC/candlestick **não** entra nesta lista — é XY e já consta como futuro
> nos planos (foco §13). Fica de fora só o que não é cartesiano.

---

## 4. Onde encaixar nos planos existentes

- **1.1 (GIF)** → tarefa solta de documentação, a qualquer momento.
- **1.3 (band scale)** → dentro da Fase 3, junto com o eixo temporal.
- **2.1 e 2.2 (cautelas)** → pré-requisitos da Fase 3 (viewport/zoom).
- **1.2 (OffscreenCanvas)** → Fase 4/5, condicionado ao benchmark.
- **1.4 (CSV)** → Fase 5 ou depois, opcional.
- **Seção 3 (descartes)** → referência; nada a implementar.

---

_Adendo vivo — anexar aos dois planos principais sem alterá-los._
