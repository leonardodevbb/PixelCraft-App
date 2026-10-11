# Arquitetura do PixelCraft

PixelCraft é um aplicativo Electron com interface React. O núcleo do editor é
TypeScript puro (sem DOM), testado com Vitest no Node; a interface e o processo
principal ficam nas bordas.

## Processos

| Processo | Código | Responsabilidade |
|---|---|---|
| Principal (Node) | `src/app`, `src/platform`, `src/storage` | Janela, diálogos nativos, leitura/gravação de arquivos, preferências, recentes, recuperação |
| Preload (isolado) | `src/preload` | Expõe **somente** a API tipada `window.pixelcraft` (`src/shared/ipc.ts`) |
| Renderer (Chromium) | `src/renderer`, `src/ui`, núcleo | Interface e todo o processamento de imagem |

Segurança do Electron: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, CSP estrita no build, navegação e novas janelas bloqueadas,
permissões do Chromium negadas. Cada argumento recebido via IPC é validado com
Zod no processo principal.

**Concessão de arquivos.** O renderer só lê/grava caminhos que o usuário
escolheu: em um diálogo nativo, na lista de recentes ou na linha de comando
(`src/platform/file-grants.ts`). Um renderer comprometido não consegue ler ou
sobrescrever arquivos arbitrários.

## Módulos

| Módulo | Pasta | Conteúdo |
|---|---|---|
| raster | `src/raster` | `PixelBuffer` (RGBA não pré-multiplicado), cores, retângulos, rasterização (Bresenham, elipse de Zingl, pincéis), mistura, escala, fonte bitmap |
| project | `src/project` | Modelo de documento, criação, limites, esquema Zod, serialização `.pixelcraft`, migrações |
| editor | `src/editor` | `EditorSession` (documento + histórico + contexto), `Painter`, ferramentas, seleção |
| history | `src/history` | Pilhas de desfazer/refazer com orçamento de memória |
| layers | `src/layers` | Composição de camadas e grupos com modos de mistura |
| animation | `src/animation` | Quadros, temporização e reprodução |
| palette | `src/palette` | Paletas padrão e formatos |
| import-export | `src/import-export` | Codec PNG próprio, decodificação de imagens, exportação |
| renderer-engine | `src/renderer-engine` | Viewport (zoom/pan) e `CanvasRenderer` (Canvas 2D) |
| shortcuts | `src/shortcuts` | Registro de comandos, atalhos, detecção de conflitos |
| ui | `src/ui` | Componentes React (painéis, menus, diálogos, ícones) |
| renderer | `src/renderer` | Entrada React, estado (Zustand), ações e comandos |
| storage | `src/storage` | Recentes e recuperação (processo principal) |
| platform | `src/platform` | Caminhos XDG, gravação atômica, concessões de arquivo |
| app | `src/app` | Ciclo de vida do Electron e handlers IPC |

## Modelo de documento

```
ProjectDocument
├── state: DocState (imutável)
│   ├── width, height
│   ├── layers: LayerNode[]   (árvore; grupos têm children, ordem de baixo para cima)
│   ├── frames: Frame[]       (id, duração em ms)
│   ├── cels: { "layerId/frameId": imageId }   (ausente = célula transparente)
│   ├── palette, animation, tiles, guides, symmetry
└── images: Map<imageId, PixelBuffer>
```

* **Células por (camada, quadro)** apontam para imagens. Duas células podem
  apontar para a mesma imagem (células vinculadas), o que torna duplicar quadros
  barato. Ao editar uma imagem compartilhada, o editor a copia antes (cópia na
  escrita), então editar um quadro nunca altera outro sem querer.
* **`DocState` é tratado como valor imutável**: cada operação gera um novo
  estado reaproveitando os ramos que não mudaram.

## Histórico

Toda alteração vira uma `HistoryEntry` com:

* o `DocState` antes e depois (por referência, custo quase zero);
* *patches* de pixels: só o retângulo alterado de cada imagem, antes e depois;
* o contexto do editor (camada/quadro ativos, seleção).

Desfazer reaplica os patches "antes" e restaura o estado; refazer faz o
inverso. A operação é atômica: não existe meio-desfazer. O consumo é
proporcional à área alterada, com orçamento configurável (padrão 256 MiB);
as entradas mais antigas são descartadas quando o limite é atingido, e imagens
que nada mais referencia são coletadas.

Ferramentas editam um **rascunho** (cópia da célula ativa). O rascunho é
mostrado ao vivo e, ao soltar o mouse, a diferença vira uma única entrada de
histórico (um traço inteiro = um desfazer).

## Renderização

`CanvasRenderer` mantém a composição do quadro em resolução de documento e
recompõe apenas a região alterada (retângulo sujo). Zoom e pan só redesenham a
imagem em cache com `imageSmoothingEnabled = false`. A grade lógica de pixels
nunca depende da escala da tela.

A exportação usa a mesma composição (código próprio, sem canvas), então o
arquivo exportado é idêntico ao que se vê, bit a bit.

## Integridade dos pixels

* Pixels ficam em RGBA não pré-multiplicado de 8 bits.
* PNG é codificado/decodificado por código próprio (`src/import-export/png.ts`),
  evitando a pré-multiplicação e o gerenciamento de cor do canvas.
* Ao salvar, o projeto é serializado, decodificado de novo e comparado com o
  documento antes de gravar; a gravação é atômica (arquivo temporário + `fsync`
  + `rename`).
