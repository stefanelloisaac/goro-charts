# Goro Charts — Direção de produto e foco técnico

## 1. Objetivo

Este documento define o foco recomendado para a evolução da **Goro Charts**.

A biblioteca não deve tentar competir com Plotly, ECharts ou Chart.js em quantidade de tipos de gráficos. O caminho mais promissor é dominar um recorte específico:

> Gráficos XY de alta performance para dados contínuos, streaming em tempo real e grandes volumes de dados.

O objetivo é tornar a Goro Charts especialmente boa para:

- séries temporais;
- telemetria;
- observabilidade;
- sensores;
- métricas operacionais;
- dashboards ao vivo;
- datasets extensos;
- múltiplos gráficos simultâneos.

---

# 2. Posicionamento recomendado

## 2.1 Posicionamento principal

A definição recomendada é:

> Uma engine TypeScript pequena e de alta performance para gráficos XY, séries temporais e dados em streaming, renderizados em Canvas 2D.

Versão curta para README:

> High-performance Canvas charts for live and large XY datasets.

Versão mais específica:

> A small, zero-dependency TypeScript charting engine for high-frequency streaming data, large XY datasets and real-time operational dashboards.

## 2.2 Por que não usar apenas “dados em tempo real”

“Dados em tempo real” é um bom caso de uso, mas é restritivo demais como definição do produto.

A biblioteca também deve atender:

- séries históricas grandes;
- dados carregados de arquivos;
- datasets científicos;
- gráficos operacionais sem streaming;
- análise de janelas temporais;
- visualização de grandes volumes com zoom e pan.

O recorte ideal é:

> Live and large XY data.

Isso cobre:

- dados chegando continuamente;
- datasets que já existem;
- dados temporais;
- dados numéricos;
- alta densidade;
- múltiplas séries;
- exploração interativa.

---

# 3. Problema que a biblioteca deve resolver

A Goro Charts deve resolver bem o seguinte cenário:

> Uma aplicação precisa exibir muitos pontos, várias séries e atualizações frequentes sem transformar a integração em um sistema complexo.

Exemplos:

- CPU, memória e rede de servidores;
- métricas de aplicações;
- sensores industriais;
- temperatura, umidade e pressão;
- telemetria veicular;
- consumo de energia;
- dados científicos;
- preços e indicadores;
- sinais de dispositivos;
- dashboards de operação.

A biblioteca deve fornecer:

- ingestão eficiente;
- memória controlada;
- renderização fluida;
- zoom e pan;
- eixo temporal;
- sincronização;
- acessibilidade;
- API simples.

---

# 4. Nicho recomendado

## 4.1 Observabilidade

Casos de uso:

- CPU;
- memória;
- disco;
- latência;
- throughput;
- erros por segundo;
- disponibilidade;
- filas;
- jobs;
- métricas de infraestrutura.

## 4.2 Telemetria

Casos de uso:

- sensores;
- máquinas;
- equipamentos;
- veículos;
- dispositivos IoT;
- aplicações embarcadas;
- monitoramento industrial.

## 4.3 Dados científicos e técnicos

Casos de uso:

- medições;
- sinais;
- séries temporais;
- testes;
- experimentos;
- processamento contínuo.

## 4.4 Indicadores e mercado

Casos de uso possíveis:

- preços;
- taxas;
- índices;
- volumes;
- cotações;
- indicadores atualizados.

A Goro Charts pode atender dados financeiros, mas não deve se posicionar inicialmente como uma biblioteca financeira.

---

# 5. O que diferencia a Goro Charts

O diferencial não deve ser a quantidade de gráficos.

Deve ser a combinação:

- performance;
- streaming;
- API simples;
- bundle pequeno;
- ausência de dependências;
- comportamento previsível;
- acessibilidade;
- suporte a múltiplos gráficos;
- TypeScript de primeira classe.

## 5.1 Comparação conceitual

| Biblioteca         | Principal força                              |
| ------------------ | -------------------------------------------- |
| uPlot              | Performance extrema e tamanho reduzido       |
| ECharts            | Variedade de gráficos e configuração         |
| Plotly             | Visualização científica e exploração         |
| Lightweight Charts | Gráficos financeiros                         |
| Chart.js           | Facilidade e popularidade                    |
| Goro Charts        | Streaming operacional simples e performático |

## 5.2 Espaço de diferenciação

A Goro Charts deve buscar:

> Performance próxima de uma engine low-level com uma API mais fácil para dashboards ao vivo.

Isso significa evitar dois extremos:

- uma API excessivamente minimalista que transfere toda a complexidade ao usuário;
- uma configuração gigantesca com centenas de opções.

---

# 6. Pilares técnicos

O foco técnico deve ser organizado em três pilares.

---

## 6.1 Pilar 1 — streaming previsível

A biblioteca deve ser excelente em:

- ingestão contínua;
- atualizações frequentes;
- janela deslizante;
- múltiplas séries sincronizadas;
- memória limitada;
- render agrupado;
- pausa e retomada;
- modo “seguir último valor”;
- destruição sem vazamentos.

### Requisitos principais

- ring buffer;
- append O(1) amortizado;
- atualizações atômicas;
- render desacoplado da ingestão;
- controle de overflow;
- métricas de atualização;
- comportamento estável em execução prolongada.

---

## 6.2 Pilar 2 — exploração de dados grandes

Mesmo em gráficos ao vivo, o usuário precisa conseguir analisar o histórico.

A biblioteca precisa oferecer:

- eixo temporal;
- viewport;
- zoom;
- pan;
- seleção de intervalo;
- reset;
- dados ausentes;
- tooltip;
- crosshair;
- sincronização;
- decimação baseada no viewport.

Sem esses recursos, a biblioteca serve apenas como monitor, não como ferramenta de análise.

---

## 6.3 Pilar 3 — muitos gráficos simultâneos

Dashboards operacionais normalmente exibem vários gráficos ao mesmo tempo.

A biblioteca deve funcionar bem com:

- 10 a 20 gráficos;
- dezenas de sparklines;
- vários gráficos sincronizados;
- uma única fonte de eventos;
- baixo consumo de memória;
- poucas alocações por frame;
- render agrupado.

Esse pode ser um diferencial mais relevante do que suportar milhões de pontos em apenas um gráfico.

---

# 7. Experiência de streaming recomendada

## 7.1 Atualização atômica

Evitar chamadas independentes para cada série.

Em vez de:

```ts
chart.append('cpu', timestamp, cpu);
chart.append('memory', timestamp, memory);
chart.append('network', timestamp, network);
```

Preferir:

```ts
chart.appendFrame(timestamp, {
  cpu,
  memory,
  network,
});
```

### Benefícios

- todas as séries recebem o mesmo timestamp;
- reduz estados intermediários;
- evita desalinhamento;
- gera uma única invalidação;
- facilita integração com WebSocket, SSE ou polling.

---

## 7.2 Append em lote

```ts
chart.appendFrames([
  {
    x: 1710000000000,
    values: {
      cpu: 45,
      memory: 72,
    },
  },
  {
    x: 1710000001000,
    values: {
      cpu: 48,
      memory: 73,
    },
  },
]);
```

### Casos de uso

- recuperação após desconexão;
- histórico inicial;
- batches recebidos da API;
- replay de eventos;
- ingestão de arquivo.

---

## 7.3 Janela deslizante

```ts
const chart = new LineChart(canvas, {
  streaming: {
    maxPoints: 10_000,
    followLatest: true,
  },
});
```

### Comportamento esperado

- manter somente a quantidade configurada;
- descartar os pontos mais antigos;
- preservar ordem;
- manter séries alinhadas;
- evitar realocação contínua.

---

## 7.4 Modo ao vivo

O gráfico deve possuir um estado explícito de acompanhamento do último valor.

```ts
chart.isFollowingLatest();
chart.setFollowLatest(true);
chart.goToLatest();
```

### Regra recomendada

Quando o usuário fizer pan para trás:

```ts
followLatest = false;
```

Quando clicar em “voltar ao vivo”:

```ts
chart.goToLatest();
chart.setFollowLatest(true);
```

### Eventos

```ts
chart.on('followLatestChange', ({ enabled }) => {});
```

---

## 7.5 Pausar e retomar

```ts
chart.pause();
chart.resume();
```

É importante definir o significado.

### Opção recomendada

`pause()` pausa o render, não necessariamente a ingestão.

```ts
chart.pause({
  ingestion: false,
  rendering: true,
});
```

Versão inicial simplificada:

```ts
chart.pauseRendering();
chart.resumeRendering();
```

Os dados continuam sendo armazenados e o gráfico redesenha ao retomar.

---

## 7.6 Frequência de ingestão e frequência de render

Os dados podem chegar mais rápido do que o navegador pode desenhar.

Exemplo:

- ingestão: 100 Hz;
- renderização: 30 ou 60 FPS.

A biblioteca deve agrupar atualizações.

```ts
streaming: {
  maxRenderRate: 30,
}
```

### Regra

- aceitar todos os dados;
- armazenar de forma eficiente;
- desenhar apenas na frequência permitida;
- sempre representar o estado mais recente.

---

## 7.7 Backpressure

Quando a entrada exceder a capacidade configurada, a biblioteca deve possuir uma política clara.

```ts
streaming: {
  overflow: 'drop-oldest',
}
```

Possíveis estratégias:

```ts
type OverflowStrategy = 'drop-oldest' | 'drop-newest' | 'aggregate';
```

### Recomendação inicial

Implementar apenas:

```ts
'drop-oldest';
```

Essa política combina naturalmente com ring buffer e janela deslizante.

---

# 8. API pública recomendada

## 8.1 Criação

```ts
const chart = new LineChart(canvas, {
  xAxis: {
    type: 'time',
  },

  streaming: {
    maxPoints: 10_000,
    followLatest: true,
    maxRenderRate: 60,
    overflow: 'drop-oldest',
  },

  interaction: {
    crosshair: true,
    zoom: true,
    pan: true,
    keyboard: true,
  },

  series: [
    {
      id: 'cpu',
      label: 'CPU',
      valueFormat: (value) => `${value.toFixed(1)}%`,
    },
    {
      id: 'memory',
      label: 'Memória',
      valueFormat: (value) => `${value.toFixed(1)}%`,
    },
  ],
});
```

## 8.2 Ingestão

```ts
chart.appendFrame(Date.now(), {
  cpu: 42.3,
  memory: 68.7,
});
```

## 8.3 Ingestão em lote

```ts
chart.appendFrames(frames);
```

## 8.4 Viewport

```ts
chart.setViewport({
  xMin,
  xMax,
});
```

```ts
chart.resetViewport();
chart.goToLatest();
```

## 8.5 Estado ao vivo

```ts
chart.isFollowingLatest();
chart.setFollowLatest(false);
```

## 8.6 Pausa

```ts
chart.pauseRendering();
chart.resumeRendering();
```

## 8.7 Sincronização

```ts
const unsubscribe = chart.syncWith(otherChart, {
  crosshair: true,
  viewport: true,
  mode: 'x-value',
});
```

## 8.8 Métricas

```ts
const metrics = chart.getMetrics();
```

```ts
interface ChartMetrics {
  storedPointCount: number;
  visiblePointCount: number;
  renderedVertexCount: number;
  renderCount: number;
  lastRenderDuration: number;
}
```

---

# 9. Funcionalidades prioritárias

A prioridade deve ser organizada pelo valor para o posicionamento da biblioteca.

---

## 9.1 Prioridade imediata

Antes de crescer o escopo:

- corrigir `yMin` e `yMax`;
- corrigir reduced motion;
- corrigir navegação por teclado;
- sincronizar crosshair por valor;
- corrigir stacking;
- corrigir métricas;
- definir ownership dos arrays;
- validar entradas;
- alinhar README e tipos.

Esses itens são necessários para o núcleo ser confiável.

---

## 9.2 Primeira grande evolução

O próximo conjunto deve ser:

1. eixo temporal;
2. formatadores;
3. viewport;
4. zoom;
5. pan;
6. dados ausentes;
7. Pointer Events;
8. `appendFrame`;
9. follow latest;
10. sincronização de viewport.

Esses recursos formam o produto mínimo coerente para live and large XY data.

---

## 9.3 Segunda evolução

Depois:

- pause e resume;
- controle de taxa de render;
- métricas de streaming;
- eventos tipados;
- batch;
- atualização dinâmica de séries;
- anotações;
- bandas;
- bar chart.

---

# 10. O que não deve ser prioridade

Não investir agora em:

- pie;
- donut;
- radar;
- gauge;
- Sankey;
- mapas;
- 3D;
- animações complexas;
- editor visual;
- sistema de temas extenso;
- parser CSV;
- gerenciamento de WebSocket;
- adaptadores de backend;
- componentes React dentro do core;
- WebGL imediato;
- DSL declarativa muito extensa.

Esses recursos não reforçam o posicionamento principal.

---

# 11. Responsabilidade da biblioteca

A Goro Charts deve receber dados, não controlar como eles chegam.

Exemplo:

```ts
socket.onmessage = ({ data }) => {
  const frame = JSON.parse(data);

  chart.appendFrame(frame.timestamp, frame.values);
};
```

A biblioteca não deve, inicialmente:

- abrir WebSocket;
- reconectar;
- autenticar;
- fazer polling;
- controlar SSE;
- buscar API;
- persistir dados.

Essas responsabilidades pertencem à aplicação.

---

# 12. Bar chart

Bar chart ainda faz sentido, mas não deve ser o próximo grande foco.

A ordem recomendada:

1. line;
2. area;
3. scatter;
4. bar;
5. bandas;
6. anotações;
7. histograma;
8. OHLC futuramente.

Bar chart deve fazer parte do núcleo XY.

Escopo sugerido:

- vertical;
- horizontal;
- agrupado;
- empilhado;
- positivo;
- negativo;
- eixo temporal quando fizer sentido;
- atualização dinâmica;
- zoom e pan.

---

# 13. Dados financeiros

A biblioteca pode suportar:

- preços;
- índices;
- taxas;
- volume;
- indicadores;
- séries de mercado.

Mas não deve começar tentando oferecer:

- candles;
- ordens;
- book;
- indicadores técnicos;
- escala de preço financeira;
- trading tools;
- marcações de operações;
- drawing tools.

Esse mercado já possui bibliotecas especializadas.

OHLC pode ser adicionado no futuro sobre o mesmo núcleo XY, sem transformar a biblioteca em uma solução exclusiva para trading.

---

# 14. Metas concretas de performance

O desenvolvimento deve ser orientado por cenários reais.

---

## 14.1 Cenário A — gráfico pesado

- 8 séries;
- 100 mil pontos visíveis;
- atualização a 30 Hz;
- crosshair responsivo;
- zoom e pan fluidos;
- nenhuma alocação grande por frame.

---

## 14.2 Cenário B — dashboard

- 20 gráficos;
- 2 a 4 séries por gráfico;
- 2 mil pontos por série;
- atualização a cada segundo;
- memória estabilizada;
- render agrupado.

---

## 14.3 Cenário C — execução prolongada

- 1 hora de streaming;
- ring buffer fixo;
- nenhum crescimento contínuo de heap;
- nenhum acúmulo de listeners;
- nenhuma degradação progressiva de FPS.

---

## 14.4 Cenário D — alta frequência

- ingestão a 100 Hz;
- renderização a 30 ou 60 FPS;
- último valor sempre preservado;
- política de descarte previsível;
- nenhuma fila infinita.

---

## 14.5 Cenário E — múltiplos gráficos sincronizados

- 10 gráficos;
- crosshair sincronizado;
- viewport sincronizado;
- escalas diferentes;
- dimensões diferentes;
- nenhum loop de sincronização.

---

# 15. Métricas que devem ser acompanhadas

## 15.1 Ingestão

- pontos por segundo;
- frames por segundo;
- custo de `appendFrame`;
- custo de `appendFrames`;
- custo de domínio incremental;
- custo do ring buffer.

## 15.2 Renderização

- tempo médio;
- p50;
- p95;
- p99;
- FPS;
- dropped frames;
- vértices renderizados;
- custo da camada estática;
- custo da camada dinâmica.

## 15.3 Memória

- heap inicial;
- heap depois de 10 minutos;
- heap depois de 1 hora;
- pico;
- estabilização;
- alocações por frame;
- tamanho dos buffers.

## 15.4 Bundle

- tamanho bruto;
- gzip;
- brotli;
- custo por tipo de gráfico;
- custo do core.

---

# 16. Benchmark comparativo

A comparação principal deve ser com uPlot.

Também podem ser utilizados:

- Chart.js;
- ECharts em Canvas;
- Lightweight Charts em cenários compatíveis.

## Regras

- mesmo dataset;
- mesmo tamanho;
- mesma quantidade de séries;
- mesmos recursos visuais;
- mesma frequência;
- mesmo navegador;
- mesma máquina;
- aquecimento;
- várias execuções;
- resultados com p50, p95 e p99.

Não comparar bibliotecas com configurações diferentes e apresentar isso como comparação direta.

---

# 17. Roadmap recomendado

---

## Fase 1 — confiabilidade

- [ ] Corrigir ranges.
- [ ] Corrigir teclado.
- [ ] Corrigir reduced motion.
- [ ] Corrigir sync.
- [ ] Corrigir stacking.
- [ ] Corrigir métricas.
- [ ] Corrigir documentação.
- [ ] Definir ownership.
- [ ] Definir validação.

### Resultado

Núcleo previsível.

---

## Fase 2 — séries temporais

- [ ] Eixo temporal.
- [ ] Formatadores.
- [ ] Dados ausentes.
- [ ] IDs de série.
- [ ] Eventos tipados.
- [ ] Atualização dinâmica.

### Resultado

Base adequada para dados temporais.

---

## Fase 3 — exploração

- [ ] Viewport.
- [ ] Zoom.
- [ ] Pan.
- [ ] Seleção.
- [ ] Reset.
- [ ] Pointer Events.
- [ ] Touch básico.

### Resultado

Análise de datasets grandes.

---

## Fase 4 — streaming de primeira classe

- [ ] `appendFrame`.
- [ ] `appendFrames`.
- [ ] `followLatest`.
- [ ] `goToLatest`.
- [ ] pause e resume.
- [ ] controle de taxa de render.
- [ ] política de overflow.
- [ ] métricas de streaming.

### Resultado

Produto claramente diferenciado.

---

## Fase 5 — dashboards

- [ ] sincronização de crosshair;
- [ ] sincronização de viewport;
- [ ] scheduler compartilhado;
- [ ] otimização para múltiplos gráficos;
- [ ] sparklines;
- [ ] benchmark com 20 gráficos.

### Resultado

Biblioteca forte para observabilidade e telemetria.

---

## Fase 6 — expansão

- [ ] Bar chart.
- [ ] Bandas.
- [ ] Anotações.
- [ ] Histogramas.
- [ ] OHLC opcional.
- [ ] Subpath exports.

### Resultado

Núcleo XY completo sem perda de foco.

---

# 18. Ordem exata de implementação

1. Corrigir `yMin` e `yMax`.
2. Corrigir teclado.
3. Corrigir reduced motion.
4. Sincronizar crosshair por valor.
5. Implementar `unsync`.
6. Corrigir stacking.
7. Corrigir métricas.
8. Compilar exemplos no CI.
9. Definir ownership.
10. Definir validação e gaps.
11. Introduzir IDs de série.
12. Implementar eixo temporal.
13. Implementar formatadores.
14. Implementar viewport.
15. Implementar zoom.
16. Implementar pan.
17. Migrar para Pointer Events.
18. Implementar `appendFrame`.
19. Implementar `appendFrames`.
20. Implementar follow latest.
21. Implementar `goToLatest`.
22. Implementar pause e resume.
23. Implementar controle de taxa de render.
24. Sincronizar viewport.
25. Criar testes de múltiplos gráficos.
26. Criar benchmark real de streaming.
27. Comparar com uPlot.
28. Implementar bar chart.
29. Implementar bandas.
30. Implementar anotações.

---

# 19. Critérios para não perder o foco

Antes de adicionar qualquer recurso, responder:

1. Esse recurso ajuda dados XY?
2. Esse recurso ajuda streaming?
3. Esse recurso ajuda datasets grandes?
4. Esse recurso ajuda dashboards?
5. Esse recurso melhora a API?
6. Esse recurso mantém o bundle pequeno?
7. Esse recurso pode ser medido?
8. Esse recurso pertence à engine ou à aplicação?

Se a maioria das respostas for “não”, o recurso provavelmente deve ficar fora do core.

---

# 20. Definição final do produto

A direção recomendada para a Goro Charts é:

> Uma biblioteca Canvas 2D de alta performance para visualizar dados XY grandes e em tempo real, com streaming previsível, interação fluida e API TypeScript simples.

Os pontos centrais devem ser:

- séries temporais;
- ingestão contínua;
- memória limitada;
- muitos pontos;
- muitos gráficos;
- zoom e pan;
- sincronização;
- acessibilidade;
- baixo custo de integração.

O próximo grande avanço da biblioteca não deve ser apenas outro tipo de gráfico.

Deve ser o conjunto:

> eixo temporal + viewport + zoom e pan + `appendFrame()` + follow latest.

Esse conjunto transforma a biblioteca de um renderer de gráficos em uma solução clara para dashboards ao vivo e grandes séries XY.
