# Goro Charts — Plano de melhorias, correções e evolução

## 1. Objetivo deste documento

Este documento organiza as melhorias recomendadas para a biblioteca **Goro Charts** em uma sequência prática de implementação.

O foco principal não é aumentar rapidamente a quantidade de tipos de gráficos. A prioridade é consolidar a biblioteca como uma solução confiável para:

- gráficos XY;
- séries temporais;
- streaming em tempo real;
- datasets grandes;
- renderização em Canvas 2D;
- API pequena e previsível;
- boa acessibilidade;
- bundle reduzido;
- performance verificável.

A ordem proposta neste documento parte do seguinte princípio:

> Primeiro corrigir contratos, comportamento e medição. Depois adicionar recursos.

---

# 2. Posicionamento recomendado

## 2.1 Proposta de valor

A Goro Charts deve se posicionar como:

> Uma biblioteca TypeScript pequena e de alta performance para gráficos XY, séries temporais e streaming em Canvas 2D, com API simples, acessibilidade e baixo custo de runtime.

## 2.2 O que a biblioteca deve priorizar

- Line charts.
- Area charts.
- Scatter charts.
- Bar charts.
- Streaming.
- Grandes volumes de dados.
- Zoom e pan.
- Eixos numéricos e temporais.
- Formatação.
- Crosshair.
- Sincronização entre gráficos.
- Anotações.
- Acessibilidade por teclado.
- Integração simples com aplicações web.

## 2.3 O que não deve ser prioridade agora

- Pie chart.
- Donut chart.
- Radar chart.
- Gauge.
- Mapas.
- Sankey.
- 3D.
- Layouts de dashboard.
- Editor visual.
- DSL declarativa muito extensa.
- Sistema de plugins complexo.
- Compatibilidade completa com Plotly ou ECharts.

Esses recursos aumentariam muito o escopo sem fortalecer o diferencial principal da biblioteca.

---

# 3. Estratégia de execução

A evolução deve ser dividida em quatro blocos:

1. **Correção**
2. **Estabilização**
3. **Recursos essenciais**
4. **Expansão controlada**

A biblioteca não deve entrar em uma fase de crescimento de recursos antes de concluir os itens críticos de correção e contrato.

---

# 4. Prioridade P0 — correções críticas

Os itens desta seção devem ser corrigidos antes da adição de novos tipos de gráficos.

---

## 4.1 Corrigir o tratamento de `yMin` e `yMax`

### Problema

O valor `0` não pode ser usado como sentinela para indicar ausência de configuração.

Exemplo válido:

```ts
const chart = new LineChart(canvas, {
  yMin: 0,
  yMax: 100,
});
```

Nesse caso, `0` deve ser tratado como limite explícito.

### Risco atual

Se o código verificar o valor com lógica booleana:

```ts
if (options.yMin) {
  // ...
}
```

O valor `0` será interpretado como falso.

Isso pode causar:

- perda do limite configurado;
- domínio Y incorreto;
- escala alterada após `setData`;
- comportamento diferente entre valores positivos e negativos;
- inconsistência entre documentação e execução.

### Correção recomendada

Os tipos devem aceitar ausência explícita:

```ts
export interface AxisRangeOptions {
  yMin?: number;
  yMax?: number;
}
```

A validação deve usar:

```ts
if (options.yMin !== undefined) {
  min = options.yMin;
}

if (options.yMax !== undefined) {
  max = options.yMax;
}
```

### Regras adicionais

- `yMin` pode ser `0`.
- `yMax` pode ser `0`.
- `yMin` pode ser negativo.
- `yMax` pode ser negativo.
- `yMin` deve ser menor que `yMax`.
- `NaN` e `Infinity` devem ser rejeitados.
- A configuração explícita deve prevalecer sobre o domínio automático.

### Critérios de aceite

- [ ] `yMin: 0` é preservado após `setData`.
- [ ] `yMax: 0` é preservado.
- [ ] Intervalos negativos funcionam.
- [ ] O domínio automático só é usado quando o limite é `undefined`.
- [ ] Configurações inválidas geram erro descritivo em desenvolvimento.
- [ ] Há testes unitários para zero, negativos e intervalo inválido.

---

## 4.2 Sincronizar crosshair por valor, não por pixel

### Problema

Sincronizar gráficos usando `clientX` ou uma posição absoluta de tela funciona apenas quando:

- os canvases possuem o mesmo tamanho;
- estão alinhados;
- possuem as mesmas margens;
- possuem o mesmo domínio;
- usam a mesma escala.

Essa abordagem não representa uma sincronização real de dados.

### Comportamento esperado

O gráfico de origem deve:

1. receber a posição do ponteiro;
2. converter pixel para valor X;
3. emitir o valor X;
4. o gráfico de destino converte o valor X para sua própria coordenada.

### API recomendada

```ts
chartA.syncWith(chartB, {
  mode: 'x-value',
});
```

Modos possíveis:

```ts
type SyncMode = 'x-value' | 'x-index' | 'pixel';
```

Para a primeira versão, implementar apenas:

```ts
mode: 'x-value';
```

O modo `pixel` pode existir internamente, mas não deveria ser o padrão.

### Estrutura interna sugerida

```ts
interface CrosshairSyncEvent {
  sourceId: string;
  xValue: number;
}
```

O gráfico receptor calcula:

```ts
const xPixel = xScale.toPixel(event.xValue);
```

### Remoção da sincronização

A API também precisa oferecer:

```ts
chartA.unsync(chartB);
```

Ou:

```ts
const unsubscribe = chartA.syncWith(chartB);

unsubscribe();
```

A segunda opção reduz o risco de vazamento de referência.

### `destroy()`

Ao destruir um gráfico:

- remover listeners;
- remover referências de sincronização;
- notificar pares sincronizados;
- impedir callbacks posteriores;
- limpar conjuntos internos.

### Critérios de aceite

- [ ] Gráficos de tamanhos diferentes sincronizam corretamente.
- [ ] Gráficos com margens diferentes sincronizam corretamente.
- [ ] Gráficos com domínios X diferentes posicionam o crosshair pelo valor.
- [ ] Valores fora do domínio são ocultados ou limitados por regra explícita.
- [ ] `unsync()` remove a sincronização.
- [ ] `destroy()` não deixa referências pendentes.
- [ ] Há testes com dois gráficos de dimensões diferentes.

---

## 4.3 Corrigir a navegação por teclado

### Problema

A documentação deve corresponder ao comportamento real.

Se a biblioteca afirma que:

- seta direita avança um ponto;
- seta esquerda volta um ponto;
- `Shift + seta` avança dez pontos;

a implementação não deve mover apenas um ou dez pixels.

### Comportamento recomendado

A navegação deve operar por índice da série de referência.

```ts
const step = event.shiftKey ? 10 : 1;

cursorIndex += direction * step;
```

Depois:

```ts
cursorIndex = clamp(cursorIndex, 0, pointCount - 1);
```

### Série de referência

Definir uma regra clara:

1. primeira série visível;
2. primeira série configurada como referência;
3. série com maior densidade;
4. série selecionada pelo usuário.

Recomendação inicial:

```ts
interaction: {
  keyboardSeriesId: 'temperature',
}
```

Caso não configurado:

- usar a primeira série visível.

### Estado inicial

Ao receber foco:

- posicionar no primeiro ponto visível; ou
- posicionar no ponto mais próximo do centro do viewport.

Não iniciar em um índice inválido como `-1`.

### Atributos acessíveis

O canvas deve possuir:

```html
<canvas tabindex="0" role="img" aria-label="Gráfico de temperatura"></canvas>
```

Ao mover o cursor, atualizar uma região viva:

```html
<div aria-live="polite">10:32, temperatura 22,4 °C</div>
```

### Critérios de aceite

- [ ] Setas navegam por ponto.
- [ ] `Shift + seta` navega por dez pontos.
- [ ] O cursor nunca fica fora do intervalo.
- [ ] O foco inicial posiciona o cursor em um ponto válido.
- [ ] Série oculta não é usada como referência.
- [ ] O valor atual é anunciado por tecnologia assistiva.
- [ ] A documentação corresponde ao comportamento.

---

## 4.4 Corrigir `prefers-reduced-motion`

### Problema

`prefers-reduced-motion` não deve interromper atualizações de dados.

A preferência significa:

- reduzir animações;
- evitar transições;
- evitar movimento visual excessivo.

Ela não significa:

- desativar renderização;
- congelar streaming;
- impedir invalidações.

### Comportamento recomendado

Quando a preferência estiver ativa:

- não animar transições;
- não interpolar valores;
- não usar efeitos de movimento;
- desenhar o estado final imediatamente;
- manter `setData`, `append` e `appendBatch` funcionais.

### Possível implementação

```ts
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (reduceMotion) {
  scheduleMode = 'immediate';
} else {
  scheduleMode = 'raf';
}
```

### Modos de agendamento

```ts
type RenderScheduleMode = 'raf' | 'immediate' | 'manual';
```

### Critérios de aceite

- [ ] Streaming continua atualizando com reduced motion.
- [ ] Não há animação quando a preferência está ativa.
- [ ] `invalidate()` causa desenho.
- [ ] O modo é atualizado se a preferência mudar em runtime.
- [ ] Há teste de integração com `matchMedia`.

---

## 4.5 Definir contrato de stacking

### Problema

Stacking exige regras fortes sobre alinhamento.

As séries podem possuir:

- quantidade diferente de pontos;
- valores X diferentes;
- intervalos diferentes;
- eixos Y diferentes;
- identificadores de stack iguais em eixos distintos.

Somar por índice sem validação pode produzir resultado incorreto.

### Contrato recomendado para a primeira versão

Stacking deve aceitar apenas séries:

- do mesmo eixo Y;
- com o mesmo `stackId`;
- com o mesmo comprimento;
- com valores X alinhados;
- com valores X na mesma ordem.

### Agrupamento correto

O identificador interno não deve usar apenas `stackId`.

Usar:

```ts
const stackKey = `${axisId}:${stackId}`;
```

Exemplo:

```ts
left: revenue;
right: revenue;
```

São stacks diferentes.

### Validação

Em ambiente de desenvolvimento:

```ts
validateStackCompatibility(series);
```

Validar:

- comprimento;
- X na mesma posição;
- eixo;
- tipo de gráfico compatível;
- presença de valores inválidos.

### Futuro

Uma versão futura pode oferecer alinhamento por X:

```ts
stacking: {
  alignment: 'strict' | 'by-x',
}
```

Para agora:

```ts
alignment: 'strict';
```

### Critérios de aceite

- [ ] Séries de eixos diferentes não são empilhadas juntas.
- [ ] Séries desalinhadas geram erro em desenvolvimento.
- [ ] Séries alinhadas são empilhadas corretamente.
- [ ] Valores positivos e negativos são tratados separadamente.
- [ ] A documentação define claramente o contrato.
- [ ] Há testes com esquerda, direita, positivo, negativo e desalinhamento.

---

## 4.6 Corrigir métricas de quantidade de pontos

### Problema

Uma propriedade chamada `renderedPointCount` não deve retornar a quantidade total armazenada.

São métricas diferentes:

- pontos armazenados;
- pontos visíveis;
- pontos processados;
- vértices efetivamente enviados ao Canvas;
- pontos após decimação.

### API recomendada

```ts
interface ChartMetrics {
  storedPointCount: number;
  visiblePointCount: number;
  renderedVertexCount: number;
  decimatedPointCount: number;
}
```

Método:

```ts
const metrics = chart.getMetrics();
```

### Significado sugerido

#### `storedPointCount`

Total presente no armazenamento.

#### `visiblePointCount`

Total dentro do viewport atual.

#### `decimatedPointCount`

Total resultante do algoritmo de decimação.

#### `renderedVertexCount`

Quantidade efetivamente usada para construir os paths.

### Critérios de aceite

- [ ] Cada métrica possui definição documentada.
- [ ] Os valores são consistentes com o renderer.
- [ ] Os benchmarks usam essas métricas.
- [ ] A decimação pode ser verificada por teste.
- [ ] Os nomes não induzem a interpretações incorretas.

---

## 4.7 Corrigir divergências entre README e tipos

### Problema

Exemplos da documentação precisam compilar.

Qualquer divergência entre:

- nome de propriedade;
- localização da propriedade;
- tipo;
- valor aceito;
- assinatura de método;

faz a documentação perder confiabilidade.

### Solução recomendada

Criar exemplos TypeScript reais dentro do repositório:

```txt
examples/
  basic-line.ts
  area-chart.ts
  scatter-chart.ts
  streaming.ts
  synchronized.ts
```

Executar no CI:

```bash
tsc --noEmit
```

Também é possível usar testes de tipo:

```ts
import { expectTypeOf } from 'vitest';
```

### Regra

Todo exemplo relevante do README deve existir como arquivo compilável.

### Critérios de aceite

- [ ] Todos os exemplos compilam.
- [ ] O README não contém propriedades inexistentes.
- [ ] Mudanças de API quebram o CI.
- [ ] Exemplos de streaming e sincronização possuem teste.
- [ ] O pacote publicado corresponde à documentação.

---

## 4.8 Definir propriedade e mutabilidade dos dados

### Problema

Ao receber arrays externos, a biblioteca precisa definir se:

- copia;
- mantém referência;
- permite mutação;
- recalcula extensões;
- detecta mudanças externas.

Sem contrato explícito, o consumidor pode alterar os arrays depois de `setData`, causando inconsistência entre:

- dados;
- domínio;
- cache;
- decimação;
- visualização.

### API recomendada

```ts
chart.setData('temperature', x, y, {
  ownership: 'borrowed',
});
```

Ou:

```ts
chart.setData('temperature', x, y, {
  ownership: 'copy',
});
```

### Modos

#### `borrowed`

- maior desempenho;
- sem cópia;
- consumidor não pode alterar os arrays;
- comportamento indefinido se houver mutação externa;
- recomendado para usuários avançados.

#### `copy`

- biblioteca copia os arrays;
- mais seguro;
- custo adicional de memória;
- recomendado como padrão inicial.

### Recomendação de padrão

Usar:

```ts
ownership: 'copy';
```

como padrão público.

Permitir `borrowed` para cenários de alta performance.

### Critérios de aceite

- [ ] O padrão é documentado.
- [ ] Arrays copiados não mudam após mutação externa.
- [ ] O modo borrowed é explicitamente marcado como imutável.
- [ ] Extensões e caches permanecem consistentes.
- [ ] Há testes para mutação externa.

---

## 4.9 Validar dados numéricos

### Problemas que precisam de contrato

- `NaN`.
- `Infinity`.
- `-Infinity`.
- comprimentos diferentes entre X e Y.
- X fora de ordem.
- timestamps duplicados.
- lote adicionado fora de ordem.
- valores ausentes.
- arrays vazios.

### Validação em desenvolvimento

```ts
validateSeriesData(x, y, {
  requireMonotonicX: true,
  allowNaNInY: true,
});
```

### Produção

Para não prejudicar performance:

- validação completa em desenvolvimento;
- validação mínima em produção;
- opção de validação explícita.

```ts
validation: 'strict' | 'basic' | 'none';
```

### Recomendação inicial

```ts
validation: import.meta.env.DEV ? 'strict' : 'basic';
```

A biblioteca não deve depender diretamente de uma variável de bundler específica. A configuração precisa ser resolvida no build da própria biblioteca ou exposta via opção.

### Critérios de aceite

- [ ] Comprimentos incompatíveis são rejeitados.
- [ ] X não monotônico é detectado.
- [ ] `Infinity` é rejeitado.
- [ ] `NaN` em Y segue uma regra documentada.
- [ ] Arrays vazios não quebram escalas.
- [ ] Erros indicam série e posição do valor inválido.

---

# 5. Prioridade P1 — estabilização da API

---

## 5.1 Adotar identificadores de série

### Problema

Usar apenas índice cria fragilidade.

Exemplo:

```ts
chart.setData(2, x, y);
```

Se a ordem das séries mudar, o código passa a atualizar a série errada.

### API recomendada

```ts
const chart = new LineChart(canvas, {
  series: [
    {
      id: 'temperature',
      label: 'Temperatura',
    },
    {
      id: 'humidity',
      label: 'Umidade',
    },
  ],
});
```

Uso:

```ts
chart.setData('temperature', x, temperature);
chart.setData('humidity', x, humidity);
```

### Tipos

```ts
type SeriesId = string;
```

### Compatibilidade

É possível manter índice temporariamente:

```ts
type SeriesReference = string | number;
```

Mas marcar índice como API legada em versão futura.

### Critérios de aceite

- [ ] Toda série pode ter `id`.
- [ ] IDs duplicados são rejeitados.
- [ ] Métodos aceitam ID.
- [ ] Mensagens de erro exibem o ID.
- [ ] Exemplos usam ID, não índice.

---

## 5.2 Atualização dinâmica de opções

### Objetivo

Permitir alteração sem destruir e recriar o gráfico.

### API sugerida

```ts
chart.setOptions({
  yAxis: {
    min: 0,
    max: 100,
  },
});
```

### Métodos úteis

```ts
chart.updateSeries('temperature', {
  color: '#ff0000',
});

chart.setSeriesVisible('temperature', false);

chart.addSeries({
  id: 'pressure',
  label: 'Pressão',
});

chart.removeSeries('pressure');
```

### Regras

Cada alteração deve indicar que camadas precisam ser invalidadas:

- layout;
- eixo;
- dados;
- camada estática;
- camada dinâmica;
- legenda;
- acessibilidade.

### Interno

```ts
enum DirtyFlag {
  None = 0,
  Layout = 1 << 0,
  Static = 1 << 1,
  Dynamic = 1 << 2,
  Data = 1 << 3,
  Accessibility = 1 << 4,
}
```

### Critérios de aceite

- [ ] Alterar cor não recalcula domínio.
- [ ] Alterar eixo recalcula layout.
- [ ] Ocultar série atualiza domínio conforme configuração.
- [ ] Adicionar e remover séries não causa vazamento.
- [ ] Atualizações são agrupadas em um único frame.

---

## 5.3 Criar operações em lote

### Problema

Aplicar muitas alterações em sequência pode causar múltiplas invalidações.

### API recomendada

```ts
chart.batch(() => {
  chart.setData('temperature', x, temperature);
  chart.setData('humidity', x, humidity);
  chart.setOptions({
    title: 'Sensores',
  });
});
```

Renderizar apenas uma vez ao final.

### Alternativa

```ts
chart.update({
  data: {
    temperature: { x, y: temperature },
    humidity: { x, y: humidity },
  },
  options: {
    title: 'Sensores',
  },
});
```

### Critérios de aceite

- [ ] Várias alterações geram um único render.
- [ ] Exceção dentro do batch não deixa estado parcial inconsistente.
- [ ] Batch aninhado funciona.
- [ ] Métrica de render confirma redução de chamadas.

---

## 5.4 Append atômico para streaming

### Objetivo

Adicionar uma amostra completa de múltiplas séries.

### API recomendada

```ts
chart.appendFrame(timestamp, {
  temperature: 22.4,
  humidity: 61,
  pressure: 1013,
});
```

### Benefícios

- séries permanecem alinhadas;
- menos chamadas públicas;
- menor risco de render intermediário;
- API melhor para telemetria;
- facilita transporte via WebSocket.

### Variante em lote

```ts
chart.appendFrames([
  {
    x: 1710000000000,
    values: {
      temperature: 22.4,
      humidity: 61,
    },
  },
  {
    x: 1710000001000,
    values: {
      temperature: 22.7,
      humidity: 60,
    },
  },
]);
```

### Critérios de aceite

- [ ] Todas as séries são atualizadas atomicamente.
- [ ] Séries ausentes seguem uma regra clara.
- [ ] Um frame causa no máximo um render.
- [ ] O ring buffer mantém alinhamento.
- [ ] Há teste com carga contínua.

---

# 6. Prioridade P1 — recursos essenciais

---

## 6.1 Eixo temporal

### Objetivo

Fazer timestamps serem tratados como primeira classe.

### API recomendada

```ts
const chart = new LineChart(canvas, {
  xAxis: {
    type: 'time',
  },
});
```

### Formatação

```ts
xAxis: {
  type: 'time',
  tickFormat: (timestamp) =>
    new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp),
}
```

### Tooltip

```ts
tooltip: {
  xFormat: (timestamp) =>
    new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(timestamp),
}
```

### Geração de ticks

Os ticks temporais devem selecionar intervalos coerentes:

- milissegundo;
- segundo;
- minuto;
- hora;
- dia;
- semana;
- mês;
- trimestre;
- ano.

### Regras

- evitar ticks sobrepostos;
- respeitar largura disponível;
- considerar fuso horário configurado;
- não assumir UTC ou local silenciosamente;
- permitir timestamps em milissegundos.

### API de timezone

```ts
xAxis: {
  type: 'time',
  timeZone: 'America/Sao_Paulo',
}
```

Para a primeira versão, a biblioteca pode apenas encaminhar valores ao formatador e não implementar lógica completa de timezone internamente.

### Critérios de aceite

- [ ] Timestamps são formatados corretamente.
- [ ] Ticks mudam conforme zoom.
- [ ] Não há sobreposição excessiva.
- [ ] Formatação customizada funciona.
- [ ] O domínio temporal suporta datasets grandes.
- [ ] Há testes de segundo, minuto, hora, dia e mês.

---

## 6.2 Formatadores de eixo e tooltip

### API recomendada

```ts
yAxis: {
  tickFormat: (value) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value),
}
```

### Série

```ts
series: [
  {
    id: 'price',
    label: 'Preço',
    valueFormat: (value) => `R$ ${value.toFixed(2)}`,
  },
];
```

### Tooltip

```ts
tooltip: {
  valueFormat: ({ value, series }) =>
    series.valueFormat?.(value) ?? String(value),
}
```

### Critérios de aceite

- [ ] Eixo X suporta formatador.
- [ ] Eixo Y suporta formatador.
- [ ] Série pode sobrescrever formatador.
- [ ] Tooltip pode usar formatação diferente.
- [ ] Formatação não altera o valor numérico interno.

---

## 6.3 Zoom, pan e viewport

### Objetivo

Permitir exploração de datasets grandes.

### API mínima

```ts
chart.setViewport({
  xMin,
  xMax,
});
```

```ts
chart.resetViewport();
```

```ts
const viewport = chart.getViewport();
```

### Interações iniciais

- roda do mouse: zoom;
- arraste: pan;
- seleção retangular horizontal: zoom;
- duplo clique: reset.

### Configuração

```ts
interaction: {
  zoom: {
    enabled: true,
    wheel: true,
    selection: true,
  },
  pan: {
    enabled: true,
    modifierKey: 'Space',
  },
}
```

### Eventos

```ts
chart.on('viewportChange', (viewport) => {
  // sincronizar estado externo
});
```

### Regras

- zoom deve ocorrer em torno do ponteiro;
- viewport não pode inverter;
- limites podem ser restringidos ao domínio completo;
- zoom mínimo deve ser configurável;
- pan deve respeitar limites;
- crosshair deve continuar funcionando.

### Critérios de aceite

- [ ] Zoom por roda mantém o ponto sob o cursor.
- [ ] Pan respeita o domínio.
- [ ] Reset restaura o domínio completo.
- [ ] O estado pode ser controlado externamente.
- [ ] Decimação usa apenas o viewport visível.
- [ ] Zoom e pan funcionam com eixo temporal.

---

## 6.4 Suporte a dados ausentes

### Contrato recomendado

Em arrays numéricos, usar `NaN` para representar ausência.

```ts
const y = new Float64Array([10, 12, Number.NaN, Number.NaN, 17]);
```

### Configuração

```ts
series: [
  {
    id: 'temperature',
    gapMode: 'break',
  },
];
```

Modos:

```ts
type GapMode = 'break' | 'connect' | 'zero';
```

Recomendação:

- padrão: `break`;
- `connect`: conecta ponto anterior ao próximo;
- `zero`: substitui ausência por zero, apenas quando explicitamente escolhido.

### Domínio

`NaN` não deve participar de:

- mínimo;
- máximo;
- stacking;
- tooltip;
- decimação numérica.

### Critérios de aceite

- [ ] `NaN` não quebra escala.
- [ ] `break` cria interrupção visual.
- [ ] `connect` conecta os extremos válidos.
- [ ] Tooltip ignora valores ausentes.
- [ ] Stacking trata ausência de forma documentada.
- [ ] Há testes com múltiplas lacunas.

---

## 6.5 Pointer Events e dispositivos móveis

### Problema

Mouse Events não cobrem adequadamente:

- touch;
- caneta;
- captura de ponteiro;
- múltiplos ponteiros.

### Migração recomendada

Usar:

```ts
pointerdown;
pointermove;
pointerup;
pointercancel;
pointerleave;
```

### Captura

```ts
canvas.setPointerCapture(event.pointerId);
```

### Primeira etapa

- crosshair por toque;
- pan com um dedo;
- seleção com mouse;
- cancelamento correto.

### Segunda etapa

- pinch zoom;
- gestos combinados;
- tolerância de movimento.

### Critérios de aceite

- [ ] Mouse continua funcionando.
- [ ] Touch move o crosshair.
- [ ] Pan funciona em dispositivo móvel.
- [ ] Eventos são cancelados corretamente.
- [ ] Não há scroll bloqueado sem necessidade.
- [ ] Há testes em navegador com emulação móvel.

---

# 7. Prioridade P2 — expansão controlada

---

## 7.1 Bar chart

O próximo tipo de gráfico recomendado é o bar chart.

### Escopo inicial

- barras verticais;
- barras horizontais;
- barras agrupadas;
- barras empilhadas;
- valores positivos;
- valores negativos;
- largura automática;
- espaçamento configurável.

### API proposta

```ts
const chart = new BarChart(canvas, {
  orientation: 'vertical',
  barMode: 'grouped',
  series: [
    {
      id: 'revenue',
      label: 'Receita',
    },
    {
      id: 'cost',
      label: 'Custo',
    },
  ],
});
```

### Modos

```ts
type BarMode = 'grouped' | 'stacked';
```

### Orientação

```ts
type BarOrientation = 'vertical' | 'horizontal';
```

### Largura

```ts
bars: {
  width: 'auto',
  maxWidth: 48,
  groupGap: 8,
  categoryGap: 16,
}
```

### Critérios de aceite

- [ ] Vertical e horizontal.
- [ ] Agrupado e empilhado.
- [ ] Positivo e negativo.
- [ ] Tooltip e crosshair.
- [ ] Suporte a viewport.
- [ ] Acessibilidade por teclado.
- [ ] Benchmark específico.

---

## 7.2 Anotações e bandas

### Casos de uso

- deploy;
- limite crítico;
- faixa de segurança;
- horário de manutenção;
- evento de negócio;
- objetivo;
- baseline.

### API proposta

```ts
annotations: [
  {
    id: 'deploy-42',
    type: 'line',
    x: 1710000000000,
    label: 'Deploy 42',
  },
  {
    id: 'critical-zone',
    type: 'band',
    yMin: 80,
    yMax: 100,
    label: 'Crítico',
  },
];
```

### Tipos iniciais

```ts
type Annotation = VerticalLineAnnotation | HorizontalLineAnnotation | XBandAnnotation | YBandAnnotation;
```

### Critérios de aceite

- [ ] Anotações acompanham zoom e pan.
- [ ] Labels não extrapolam o canvas.
- [ ] Bandas funcionam em ambos os eixos.
- [ ] Há controle de ordem de renderização.
- [ ] Atualização dinâmica funciona.

---

## 7.3 Eventos de interação

### API proposta

```ts
chart.on('pointHover', (event) => {});
chart.on('pointClick', (event) => {});
chart.on('viewportChange', (event) => {});
chart.on('seriesVisibilityChange', (event) => {});
```

### Estrutura

```ts
interface PointInteractionEvent {
  seriesId: string;
  index: number;
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
}
```

### Critérios de aceite

- [ ] Eventos possuem tipos públicos.
- [ ] Listeners podem ser removidos.
- [ ] `destroy()` limpa listeners.
- [ ] Não há emissão excessiva sem throttling.
- [ ] Pointer, teclado e API programática usam o mesmo modelo.

---

# 8. Performance

---

## 8.1 Corrigir a linguagem das promessas

Evitar promessas absolutas como:

> custo de desenho constante, independentemente da quantidade de dados.

Mesmo com decimação, ainda pode existir custo proporcional para:

- localizar viewport;
- percorrer pontos;
- calcular buckets;
- atualizar extensões;
- processar gaps;
- gerar dados intermediários.

Uma descrição mais precisa seria:

> A complexidade do path renderizado é limitada pela resolução horizontal do gráfico após a decimação.

Ou:

> A decimação mantém a quantidade de vértices renderizados próxima da largura do viewport, mesmo em datasets grandes.

---

## 8.2 Separar benchmarks por etapa

### Ingestão

Medir:

- `setData`;
- `append`;
- `appendBatch`;
- `appendFrame`;
- ring buffer;
- realocação;
- cálculo de domínio.

### Renderização

Medir:

- preparação;
- decimação;
- path;
- eixos;
- tooltip;
- camada estática;
- camada dinâmica.

### Interação

Medir:

- crosshair;
- hover;
- zoom;
- pan;
- resize;
- sincronização.

### Memória

Medir:

- heap inicial;
- heap após ingestão;
- pico;
- heap estabilizado;
- alocações por frame;
- quantidade de garbage collections.

---

## 8.3 Matriz mínima de benchmark

| Cenário      | Valores                          |
| ------------ | -------------------------------- |
| Pontos       | 10k, 100k, 500k, 1M              |
| Séries       | 1, 4, 8, 16                      |
| Atualizações | 1, 10, 30, 60 por segundo        |
| Tamanho      | 600×300, 1200×600, 1920×1080     |
| DPR          | 1, 1.5, 2                        |
| Navegadores  | Chromium, Firefox, WebKit        |
| Modo         | dados estáticos, streaming, zoom |
| Decimação    | ativada, desativada              |

---

## 8.4 Métricas

- média;
- mediana;
- p95;
- p99;
- FPS;
- dropped frames;
- tempo de ingestão;
- tempo de render;
- memória;
- bundle gzip;
- bundle brotli;
- vértices renderizados;
- pontos armazenados.

### Exemplo de orçamento

```txt
100 mil pontos, 4 séries, 1200×600:

- p95 de render <= 16 ms
- atualização a 30 Hz sem crescimento contínuo de heap
- bundle gzip <= 25 kB
- zero alocações grandes por frame
```

Os limites exatos devem ser definidos depois da primeira medição real.

---

## 8.5 Benchmark comparativo

Comparar com bibliotecas de escopo próximo.

Prioridade:

1. uPlot;
2. lightweight-charts, quando o cenário fizer sentido;
3. ECharts em Canvas;
4. Chart.js, como referência popular.

A comparação deve usar:

- mesmo dataset;
- mesma quantidade de séries;
- mesmo tamanho;
- mesma frequência;
- recursos visuais equivalentes;
- mesma máquina;
- mesmo navegador;
- aquecimento;
- várias repetições.

Não comparar configurações visualmente diferentes ou recursos não equivalentes.

---

## 8.6 Benchmarks no navegador

`node-canvas` pode ser útil para testes isolados, mas não substitui navegador real.

Usar Playwright ou outra ferramenta de automação para medir:

- `performance.now()`;
- `PerformanceObserver`;
- long tasks;
- memória quando disponível;
- frames;
- screenshots;
- interação real.

### Critérios de aceite

- [ ] Benchmark executa em navegador.
- [ ] Resultados são reproduzíveis.
- [ ] Configuração é versionada.
- [ ] O CI detecta regressões grandes.
- [ ] Resultados não misturam ingestão e render.

---

# 9. Testes

---

## 9.1 Testes unitários

Cobrir:

- escalas;
- ticks;
- domínio;
- decimação;
- ring buffer;
- monotonicidade;
- stacking;
- gaps;
- formatadores;
- viewport;
- cálculo de barra;
- métricas.

### Casos obrigatórios

- zero;
- negativo;
- arrays vazios;
- um ponto;
- dois pontos;
- `NaN`;
- milhões de pontos;
- overflow do ring buffer;
- eixo invertido;
- domínio constante;
- DPR fracionário.

---

## 9.2 Testes de integração em navegador

Usar Playwright.

### Navegadores

- Chromium;
- Firefox;
- WebKit.

### Casos

- render inicial;
- resize;
- DPR;
- crosshair;
- sincronização;
- teclado;
- reduced motion;
- zoom;
- pan;
- touch;
- destroy;
- mudança de tema;
- visibilidade de série.

---

## 9.3 Testes visuais

Criar screenshots de referência para:

- linha;
- área;
- scatter;
- stacking;
- gaps;
- múltiplos eixos;
- tema claro;
- tema escuro;
- zoom;
- tooltip;
- seleção;
- barras.

### Regras

- tolerância pequena;
- ambiente fixo;
- fontes controladas;
- dimensão fixa;
- DPR fixo;
- atualização explícita das imagens de referência.

---

## 9.4 Testes de acessibilidade

Testar:

- foco;
- ordem de tabulação;
- atalhos;
- `aria-label`;
- região viva;
- contraste;
- reduced motion;
- comportamento sem mouse.

Pode ser utilizado:

- axe-core;
- Playwright;
- testes manuais com leitor de tela.

---

## 9.5 Testes de tipos

Todo exemplo público deve compilar.

Adicionar testes para:

- opções corretas;
- opções inválidas;
- IDs de série;
- callbacks;
- eventos;
- tipos de anotação;
- viewport;
- plugins futuros.

---

# 10. Documentação

---

## 10.1 README principal

O README deve responder rapidamente:

1. O que é.
2. Para qual problema serve.
3. Instalação.
4. Exemplo mínimo.
5. Streaming.
6. Performance.
7. Tipos de gráfico.
8. Compatibilidade.
9. Limitações.
10. Links para documentação detalhada.

---

## 10.2 Documentação por conceito

Sugestão:

```txt
docs/
  getting-started.md
  concepts/
    data-model.md
    rendering.md
    axes.md
    viewport.md
    streaming.md
    accessibility.md
    performance.md
  api/
    chart-base.md
    line-chart.md
    area-chart.md
    scatter-chart.md
    bar-chart.md
  guides/
    realtime-dashboard.md
    synchronized-charts.md
    large-datasets.md
    time-series.md
```

---

## 10.3 Documentar contratos

A documentação deve declarar explicitamente:

- propriedade dos arrays;
- monotonicidade de X;
- comportamento de `NaN`;
- stacking;
- sincronização;
- unidades de timestamp;
- eixo local ou UTC;
- quantidade máxima recomendada;
- custo de cópia;
- quando usar ring buffer;
- quando a decimação é aplicada;
- limitações de acessibilidade do Canvas.

---

## 10.4 Exemplos executáveis

Criar exemplos reais:

- linha básica;
- múltiplas séries;
- streaming;
- ring buffer;
- eixo temporal;
- gaps;
- zoom;
- sincronização;
- múltiplos eixos;
- bar chart;
- anotações.

Cada exemplo deve:

- compilar;
- rodar;
- ser simples;
- usar a API recomendada;
- não depender de código oculto.

---

# 11. Distribuição e pacote npm

---

## 11.1 Compatibilidade de Node

Como a biblioteca roda no navegador, não deve exigir uma versão de Node maior do que o necessário para consumir o pacote.

Recomendações:

- remover `engines.node` caso não seja necessária;
- ou usar a menor versão suportada de forma real;
- separar requisito de desenvolvimento do requisito de consumo.

O ambiente de build pode usar Node moderno sem forçar o consumidor a usar a mesma versão.

---

## 11.2 Formatos do pacote

Publicar:

- ESM;
- tipos TypeScript;
- sourcemaps;
- build minificado;
- package exports.

Exemplo:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

---

## 11.3 Subpath exports

Não dividir em vários pacotes agora.

Quando necessário, permitir:

```ts
import { LineChart } from 'goro-charts/line';
import { BarChart } from 'goro-charts/bar';
```

Exemplo:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./line": "./dist/line.js",
    "./area": "./dist/area.js",
    "./scatter": "./dist/scatter.js",
    "./bar": "./dist/bar.js"
  }
}
```

Implementar apenas quando existir ganho real de tree-shaking ou organização.

---

## 11.4 `sideEffects`

Definir:

```json
{
  "sideEffects": false
}
```

Somente se for realmente seguro.

Verificar se:

- não há registro global;
- não há alteração de protótipos;
- não há import de CSS com efeito;
- não há inicialização automática.

---

## 11.5 Bundle budgets

Adicionar limite no CI:

```txt
core:
- raw <= X kB
- gzip <= Y kB
- brotli <= Z kB
```

Também medir por entrada:

- core;
- line;
- area;
- scatter;
- bar.

---

# 12. Arquitetura interna

---

## 12.1 Separar dados, layout e render

A pipeline deve ser explícita:

```txt
dados
  ↓
validação
  ↓
domínio
  ↓
viewport
  ↓
layout
  ↓
decimação
  ↓
render estático
  ↓
render dinâmico
```

Cada etapa deve possuir entradas e saídas claras.

---

## 12.2 Evitar um `ChartBase` monolítico

Responsabilidades que devem ser separadas:

- lifecycle;
- armazenamento;
- viewport;
- eixos;
- interação;
- acessibilidade;
- sincronização;
- renderização;
- métricas;
- eventos.

Possível divisão:

```txt
ChartController
SeriesStore
ViewportController
InteractionController
AccessibilityController
SyncController
Renderer
MetricsCollector
```

Isso não significa criar arquivos ou abstrações desnecessárias imediatamente. A separação deve acontecer quando a responsabilidade começar a crescer.

---

## 12.3 Modelo de invalidação

A biblioteca deve evitar redesenhar tudo sempre.

Tipos de invalidação:

- dados;
- layout;
- camada estática;
- camada dinâmica;
- interação;
- acessibilidade.

Exemplo:

```ts
enum Invalidation {
  Data = 1 << 0,
  Layout = 1 << 1,
  Static = 1 << 2,
  Dynamic = 1 << 3,
  Accessibility = 1 << 4,
}
```

### Exemplos

#### Movimento do ponteiro

Redesenhar apenas:

- crosshair;
- tooltip;
- camada dinâmica.

#### Mudança de tamanho

Redesenhar:

- layout;
- eixos;
- séries;
- camada estática;
- camada dinâmica.

#### Mudança de cor

Redesenhar:

- série;
- legenda;
- sem recalcular domínio.

---

# 13. API pública recomendada

Exemplo de direção futura:

```ts
import { LineChart, type LineChartOptions } from 'goro-charts';

const options: LineChartOptions = {
  xAxis: {
    type: 'time',
    tickFormat: (value) =>
      new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(value),
  },

  yAxis: {
    min: 0,
    tickFormat: (value) =>
      new Intl.NumberFormat('pt-BR', {
        maximumFractionDigits: 1,
      }).format(value),
  },

  interaction: {
    crosshair: true,
    keyboard: true,
    zoom: true,
    pan: true,
  },

  series: [
    {
      id: 'temperature',
      label: 'Temperatura',
      valueFormat: (value) => `${value.toFixed(1)} °C`,
      gapMode: 'break',
    },
  ],
};

const chart = new LineChart(canvas, options);

chart.setData('temperature', timestamps, values, {
  ownership: 'copy',
});

chart.on('viewportChange', (viewport) => {
  console.log(viewport);
});
```

Streaming:

```ts
chart.appendFrame(Date.now(), {
  temperature: 22.4,
});
```

Sincronização:

```ts
const unsubscribe = chart.syncWith(otherChart, {
  mode: 'x-value',
});
```

Destruição:

```ts
unsubscribe();
chart.destroy();
```

---

# 14. Roadmap recomendado

---

## Fase 1 — correção

### Objetivo

Remover comportamentos incorretos e alinhar código, tipos e documentação.

### Itens

- [ ] Corrigir `yMin` e `yMax`.
- [ ] Corrigir crosshair sync.
- [ ] Adicionar `unsync`.
- [ ] Corrigir teclado.
- [ ] Corrigir reduced motion.
- [ ] Corrigir stacking.
- [ ] Corrigir métricas de pontos.
- [ ] Corrigir exemplos do README.
- [ ] Definir propriedade dos arrays.
- [ ] Definir validação de dados.

### Resultado esperado

Versão confiável, sem aumentar o escopo funcional.

---

## Fase 2 — estabilização

### Objetivo

Tornar a API preparada para crescimento.

### Itens

- [ ] IDs de série.
- [ ] Atualização dinâmica de opções.
- [ ] Mostrar e ocultar séries.
- [ ] Adicionar e remover séries.
- [ ] Operações em batch.
- [ ] Append atômico.
- [ ] Eventos tipados.
- [ ] Modelo de invalidação.

### Resultado esperado

API estável o suficiente para uso em aplicações reais.

---

## Fase 3 — fundamentos de séries temporais

### Objetivo

Transformar a biblioteca em uma solução forte para séries temporais.

### Itens

- [ ] Eixo temporal.
- [ ] Formatadores.
- [ ] Dados ausentes.
- [ ] Viewport.
- [ ] Zoom.
- [ ] Pan.
- [ ] Pointer Events.
- [ ] Touch básico.

### Resultado esperado

Biblioteca adequada para dashboards e telemetria.

---

## Fase 4 — validação de performance

### Objetivo

Substituir promessas por evidência.

### Itens

- [ ] Benchmark real em navegador.
- [ ] Métricas separadas.
- [ ] Comparação com uPlot.
- [ ] Teste de memória.
- [ ] Teste de streaming.
- [ ] Bundle budget.
- [ ] Regressão no CI.

### Resultado esperado

Posicionamento de performance sustentado por números reproduzíveis.

---

## Fase 5 — expansão

### Objetivo

Adicionar recursos com alto retorno.

### Itens

- [ ] Bar chart.
- [ ] Anotações.
- [ ] Bandas.
- [ ] Eventos avançados.
- [ ] Sincronização de viewport.
- [ ] Pinch zoom.
- [ ] Subpath exports.

### Resultado esperado

Núcleo XY completo sem perder foco.

---

# 15. Ordem exata recomendada de implementação

1. Corrigir `yMin` e `yMax`.
2. Corrigir keyboard navigation.
3. Corrigir reduced motion.
4. Refatorar crosshair sync para valor X.
5. Criar `unsync` e limpeza em `destroy`.
6. Corrigir stacking.
7. Corrigir métricas.
8. Compilar exemplos do README no CI.
9. Definir ownership dos arrays.
10. Definir validação e gaps.
11. Introduzir IDs de série.
12. Criar `setOptions`.
13. Criar atualização dinâmica de séries.
14. Criar batch.
15. Criar `appendFrame`.
16. Implementar eixo temporal.
17. Implementar formatadores.
18. Implementar viewport.
19. Implementar zoom.
20. Implementar pan.
21. Migrar para Pointer Events.
22. Criar testes Playwright.
23. Refazer benchmarks.
24. Criar comparação com uPlot.
25. Implementar bar chart.
26. Implementar anotações.

---

# 16. Definition of Done

Uma tarefa só deve ser considerada concluída quando atender a todos os itens aplicáveis.

## Código

- [ ] API tipada.
- [ ] Sem quebra não documentada.
- [ ] Sem vazamento de listener.
- [ ] Sem alocação desnecessária em loop crítico.
- [ ] Comportamento definido para entrada inválida.

## Testes

- [ ] Teste unitário.
- [ ] Teste de integração quando aplicável.
- [ ] Teste visual quando houver alteração de render.
- [ ] Teste de tipos para API pública.
- [ ] Teste de navegador para interação.

## Documentação

- [ ] README atualizado.
- [ ] Exemplo compilável.
- [ ] Contrato explicado.
- [ ] Limitações declaradas.
- [ ] Migração documentada quando houver quebra.

## Performance

- [ ] Benchmark antes e depois.
- [ ] Sem regressão relevante.
- [ ] Métricas reproduzíveis.
- [ ] Bundle dentro do orçamento.

## Acessibilidade

- [ ] Teclado.
- [ ] Foco.
- [ ] Leitor de tela.
- [ ] Reduced motion.
- [ ] Contraste quando aplicável.

---

# 17. Critérios para a primeira versão estável

A biblioteca pode ser considerada pronta para uma versão estável quando possuir:

- [ ] API pública documentada.
- [ ] IDs de série.
- [ ] Line, area e scatter estáveis.
- [ ] Streaming estável.
- [ ] Ring buffer estável.
- [ ] Eixo temporal.
- [ ] Formatadores.
- [ ] Zoom e pan.
- [ ] Dados ausentes.
- [ ] Crosshair sincronizado por valor.
- [ ] Navegação por teclado correta.
- [ ] Reduced motion correto.
- [ ] Testes reais em navegador.
- [ ] Benchmark reproduzível.
- [ ] Exemplos compiláveis.
- [ ] Sem divergência conhecida entre tipos e documentação.
- [ ] Política de versionamento.
- [ ] Changelog.
- [ ] Guia de migração.

O bar chart pode entrar antes ou depois da primeira versão estável, dependendo da prioridade do projeto. Ele não deve bloquear a estabilização do núcleo.

---

# 18. Resumo executivo

A Goro Charts já possui uma direção técnica adequada para se tornar uma biblioteca relevante.

O maior risco atual não é falta de recursos. É expandir antes de consolidar:

- comportamento;
- contratos;
- API;
- acessibilidade;
- testes;
- performance;
- documentação.

A prioridade deve ser:

1. corrigir inconsistências;
2. estabilizar a API;
3. fortalecer séries temporais;
4. medir performance de forma real;
5. adicionar bar chart e anotações;
6. evitar escopo excessivo.

O diferencial da biblioteca deve ser:

- API mais simples que bibliotecas extremamente low-level;
- desempenho previsível;
- streaming de primeira classe;
- Canvas 2D;
- acessibilidade funcional;
- bundle pequeno;
- documentação tecnicamente confiável.

A biblioteca não precisa se tornar um substituto completo para Plotly ou ECharts. Ela precisa ser excelente no seu recorte.
