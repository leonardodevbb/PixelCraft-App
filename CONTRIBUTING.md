# Contribuindo com o PixelCraft

## Ambiente

* Node.js 22+ e npm 10+
* Linux (o app também roda em outras plataformas para desenvolvimento, mas os
  pacotes e testes de distribuição são para Linux)

```bash
npm install
npm run dev        # Vite + Electron com recarga
```

Para rodar como root (containers), o script de desenvolvimento adiciona
`--no-sandbox` automaticamente.

## Verificações antes de enviar

```bash
npm run typecheck
npm run lint
npm test           # testes unitários (Vitest)
npm run test:e2e   # testes de interface com Electron (Playwright); use xvfb-run sem display
```

## Regras do projeto

* O núcleo (`src/raster`, `src/project`, `src/editor`, `src/history`,
  `src/layers`, `src/animation`, `src/palette`, `src/import-export`) não usa DOM
  e precisa de testes unitários.
* Nenhuma operação pode alterar pixels silenciosamente. Escala sempre por
  vizinho mais próximo, salvo opção explícita.
* Toda alteração do documento passa por `EditorSession.commit`/`apply`/
  `writeCel` para gerar uma entrada atômica de histórico.
* Ações do usuário são comandos (`src/renderer/commands.ts`). Menus, atalhos e
  a busca de comandos leem do registro; não duplique lógica em componentes.
* IPC novo: declare no contrato `src/shared/ipc.ts`, valide argumentos com Zod
  no processo principal e nunca exponha APIs genéricas do Node.
* Mudou o formato `.pixelcraft`? Veja `docs/PROJECT_FORMAT.md`.

Commits pequenos e descritivos. Pull requests devem passar em todas as
verificações acima.
