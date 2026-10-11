# Componentes de terceiros

O PixelCraft não usa serviços online, não tem telemetria e não baixa nada em
tempo de execução. O que vai dentro dos pacotes:

| Componente | Versão | Licença | Uso |
|---|---|---|---|
| [Electron](https://www.electronjs.org/) (Chromium, Node.js) | 41.10.7 | MIT; Chromium e dependências: várias (BSD, LGPL, etc.) | Runtime do aplicativo. A lista completa de licenças do Chromium acompanha os pacotes em `LICENSES.chromium.html`. |
| [React](https://react.dev/) e React DOM | 19.3.0 | MIT | Interface |
| scheduler (dependência do React) | 0.28.0 | MIT | Interface |
| [Zustand](https://github.com/pmndrs/zustand) | 5.0.15 | MIT | Estado da interface |
| [Zod](https://zod.dev/) | 4.6.5 | MIT | Validação de IPC, preferências e do formato `.pixelcraft` |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | ZIP e DEFLATE (projeto `.pixelcraft` e PNG) |

Somente no desenvolvimento (não vão nos pacotes): TypeScript, Vite, esbuild,
ESLint, Vitest, Playwright, electron-builder, flatpak-builder e
[axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0, usado nos testes
de acessibilidade).

## Criado para o projeto (MIT)

* **Codificadores e decodificadores** de PNG, GIF (LZW, quantização median cut)
  e BMP: `src/import-export`. JPEG e WebP usam os codificadores do Chromium.
* **Fonte bitmap PixelCraft Sans 5×7** com acentos (`src/raster/bitmap-font.ts`).
* **Ícones da interface** (`src/ui/icon-data.ts`) e **marca** (logo, símbolo e
  ícone do app em `assets/branding`, gerados por `npm run branding`).
* **Paletas incluídas** (PixelCraft 32, Escala de cinza 8, Verde portátil 4,
  Quentes 16).

A interface usa as fontes do sistema (pilha `system-ui`); nenhuma fonte é
embutida.

## Formatos de terceiros suportados

GPL (GIMP), JASC-PAL (Paint Shop Pro), ACT (Adobe Color Table), HEX
(Lospec), mapa JSON do [Tiled](https://www.mapeditor.org/) (`.tmj`) e JSON de
spritesheet no formato "array" compatível com Aseprite. Os formatos foram
implementados a partir das especificações públicas; nenhum código desses
programas foi usado.
