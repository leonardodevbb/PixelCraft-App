# Testes

| Camada | Ferramenta | Onde | Comando |
|---|---|---|---|
| Tipos | TypeScript estrito | todo o código | `npm run typecheck` |
| Estilo e erros comuns | ESLint | todo o código | `npm run lint` |
| Unidade | Vitest (Node, sem DOM) | `tests/unit` | `npm test` |
| Interface (ponta a ponta) | Playwright + Electron | `tests/e2e` | `npm run test:e2e` |
| Acessibilidade | axe-core (WCAG 2.1 A/AA) dentro do Playwright | `tests/e2e/a11y.spec.ts` | parte do `test:e2e` |
| Pacotes | `scripts/verify-packages.sh` | `release/` | `npm run verify:packages` |

## Unidade

Cobrem o núcleo sem interface: rasterização (linhas, elipses, pincéis,
simetria), ferramentas (lápis, borracha, formas, balde, seleções, mover, texto,
degradê), histórico com orçamento de memória e células vinculadas, camadas e
grupos (mover, mesclar, mesclagem e opacidade), operações de imagem (redimensionar,
cortar, girar, deslocar, substituir cor), paletas (formatos GPL/HEX/JSON/JASC/ACT,
análise e redução de cores), animação (quadros, ordem de reprodução, marcadores),
codecs (PNG, GIF, BMP e leitura do tamanho de JPEG/WebP antes de decodificar),
spritesheet e fatiamento, tileset e mapa do Tiled, formato `.pixelcraft`
(gravação, leitura, migração e arquivos maliciosos), registro de comandos (sem
atalhos em conflito, menus só com comandos existentes) e a documentação de
atalhos (`docs/SHORTCUTS.md` precisa bater com o registro).

`tests/unit/perf.test.ts` mede operações num documento 2048×2048 com 8
camadas e falha se ficarem muito lentas. Os tempos aparecem na saída
(`[perf] ...`). Num servidor de desenvolvimento comum:

| Operação | Tempo |
|---|---|
| Balde em 4,2 megapixels | ~0,2 s |
| Composição de 8 camadas 2048² | ~0,1 s |
| Traço de lápis com 200 pontos | ~0,06 s |
| Desfazer + refazer | ~10 ms |
| PNG 2048² (gravar / ler) | ~0,7 s / ~0,25 s |
| GIF de 30 quadros 256² com milhares de cores | ~3 s (roda em segundo plano, a interface não trava) |

## Interface

Os testes abrem o app Electron de verdade, com diretórios XDG isolados num
`HOME` temporário, e usam a interface como um usuário: cliques no canvas,
atalhos, menus e diálogos. Os diálogos nativos de abrir e salvar são
substituídos (`stubOpenDialog`/`stubSaveDialog`) para apontar para arquivos
temporários, e os arquivos gerados são lidos e decodificados para conferir os
pixels.

* `phase1`: desenhar, desfazer, salvar e reabrir `.pixelcraft`, exportar PNG,
  abrir pelo diálogo, recusar arquivos inválidos e avisar antes de descartar
  alterações não salvas.
* `phase2`: seleção, copiar/colar (área de transferência do sistema), camadas,
  paletas, preferências e tema claro.
* `phase3`: quadros, duração, reprodução, papel vegetal, GIF, spritesheet com
  JSON e sequência de PNG.
* `phase4`: texto, degradê, paleta de comandos, atalho personalizado,
  JPEG/WebP/BMP, importar como camada e tileset com mapa do Tiled.
* `stability`: o app é encerrado à força (SIGKILL) depois do salvamento
  automático; ao abrir de novo, a tela inicial oferece a cópia e ela é
  restaurada com os pixels certos.
* `a11y`: auditoria axe na tela inicial, no editor (temas escuro e claro) e em
  13 diálogos; tutorial de primeiros passos.

Sem display (servidor, CI, container):

```bash
npm run build
xvfb-run -a npx playwright test
```

Rodando como root (containers), os testes passam `--no-sandbox` sozinhos.

Variáveis úteis:

* `PIXELCRAFT_SHOTS=<pasta>`: salva capturas de tela em alguns pontos.
* `PIXELCRAFT_E2E_EXECUTABLE=<binário>`: roda a suíte contra um app
  empacotado em vez do código-fonte, por exemplo
  `PIXELCRAFT_E2E_EXECUTABLE=$PWD/release/linux-unpacked/pixelcraft xvfb-run -a npx playwright test`
  depois de `npx electron-builder --linux dir`.

## Pacotes

Veja [BUILD_LINUX.md](BUILD_LINUX.md#verificação). Em resumo:
`bash scripts/verify-packages.sh --smoke` confere o conteúdo do .deb e do
AppImage e inicia cada um com `--smoke-test`.

## CI

`.github/workflows/ci.yml` roda tipos, lint, unidade e interface em todo pull
request e, em seguida, gera e verifica .deb, AppImage e Flatpak, publicando os
três como artefatos.
