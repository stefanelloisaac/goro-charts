# Goro Charts — Visão de produto

## 1. Objetivo

A Goro Charts deve ser uma biblioteca pequena, previsível e especializada em
gráficos XY para dados grandes e dados vivos.

Ela não deve tentar competir com Plotly, ECharts ou Chart.js em quantidade de
tipos de gráfico. O caminho mais forte é dominar um recorte específico:

> High-performance Canvas charts for live and large XY datasets.

Em português:

> Gráficos Canvas de alta performance para dados XY grandes e em tempo real.

## 2. Posicionamento

A Goro Charts é uma engine TypeScript, framework-agnostic e sem dependências de
runtime para visualização de séries XY contínuas.

Ela deve ser especialmente boa para:

- séries temporais;
- telemetria;
- observabilidade;
- métricas operacionais;
- sensores;
- dashboards ao vivo;
- datasets extensos;
- múltiplos gráficos simultâneos.

O produto deve transmitir três ideias:

1. **pequeno** — fácil de instalar, entender e embutir;
2. **rápido** — adequado para dados grandes e atualização frequente;
3. **previsível** — comportamento claro em streaming, interação e memória.

## 3. Público-alvo

A biblioteca é mais útil para desenvolvedores construindo:

- painéis de observabilidade;
- dashboards de telemetria;
- visualização de sensores ou IoT;
- ferramentas internas de monitoramento;
- interfaces para séries temporais técnicas;
- visualizações compactas em produtos SaaS;
- gráficos operacionais que precisam permanecer leves.

A biblioteca também pode atender dados científicos, industriais e financeiros,
mas não deve se posicionar inicialmente como uma solução científica completa ou
uma plataforma de trading.

## 4. Diferenciação

O diferencial não é oferecer todos os tipos de gráfico.

O diferencial é combinar:

- performance;
- bundle pequeno;
- zero dependência de runtime;
- API TypeScript simples;
- streaming previsível;
- boa experiência com datasets grandes;
- boa experiência com múltiplos gráficos;
- renderização Canvas 2D direta.

Comparação conceitual:

| Biblioteca         | Força principal                                      |
| ------------------ | ---------------------------------------------------- |
| uPlot              | Performance extrema e tamanho reduzido               |
| ECharts            | Variedade de gráficos e configuração extensa         |
| Plotly             | Exploração científica e visualização rica            |
| Lightweight Charts | Gráficos financeiros                                 |
| Chart.js           | Popularidade e facilidade geral                      |
| Goro Charts        | Dados XY grandes/vivos com core pequeno e previsível |

A Goro Charts deve buscar performance próxima de engines low-level, mas com uma
API mais direta para dashboards e produtos operacionais.

## 5. Escopo principal

O núcleo da biblioteca deve permanecer centrado em gráficos XY:

- line;
- area;
- scatter;
- variações XY que reaproveitem o mesmo modelo mental.

Tipos adicionais só fazem sentido quando reforçam esse núcleo. Bar chart pode
entrar como expansão XY. Pizza, radar, gauge, mapas, 3D e visualizações
altamente especializadas não pertencem ao foco principal.

## 6. Princípios de produto

### 6.1 Especialização antes de abrangência

É melhor ser excelente em live and large XY data do que mediano em dezenas de
tipos de gráfico.

### 6.2 Previsibilidade antes de mágica

O usuário deve entender quando dados entram, quando o gráfico redesenha, como a
memória é limitada e o que acontece em execução prolongada.

### 6.3 Core pequeno antes de ecossistema grande

O core deve continuar leve. Integrações, adaptadores e conveniências só entram
quando não comprometem tamanho, clareza ou independência de framework.

### 6.4 Responsabilidade clara

A biblioteca recebe e visualiza dados. Ela não deve controlar como os dados são
buscados, autenticados, reconectados ou persistidos.

### 6.5 Performance comprovável

Qualquer promessa de performance precisa ser sustentada por evidência em casos
reais de uso. Marketing não deve substituir resultado observável.

## 7. Fora de foco

Não devem ser prioridade para o core:

- pie/donut/radar/gauge/funnel;
- mapas;
- 3D;
- editor visual;
- sistema extenso de temas;
- gerenciamento de WebSocket;
- autenticação ou polling;
- parser CSV como responsabilidade central;
- componentes React/Vue/Svelte dentro do core;
- DSL declarativa pesada;
- sistema de plugins antes do core estar maduro;
- trocar a tecnologia central como primeira resposta para problemas que ainda
  podem ser resolvidos dentro do foco atual.

## 8. Direção de evolução

A evolução deve seguir esta prioridade conceitual:

1. tornar o núcleo XY confiável;
2. garantir performance em dados grandes e vivos;
3. melhorar ergonomia da API sem aumentar confusão;
4. expandir o núcleo XY somente quando o foco principal estiver preservado.

Planos técnicos, fases, decisões de implementação e critérios de aceite ficam em
`docs/phases/`. Este documento permanece como visão canônica do produto.

## 9. Definição final

A direção da Goro Charts é:

> Uma biblioteca Canvas 2D pequena e sem dependências para visualizar dados XY
> grandes e em tempo real, com performance mensurável, comportamento previsível
> e API TypeScript simples.
