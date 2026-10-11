# Pacotes Linux

O PixelCraft é distribuído em três formatos. Os três contêm o mesmo aplicativo
(a pasta `release/linux-unpacked` gerada pelo electron-builder).

| Formato | Comando | Arquivo gerado | Situação |
|---|---|---|---|
| Debian/Ubuntu | `npm run package:deb` | `release/pixelcraft_<versão>_amd64.deb` | Gerado, instalado, executado e removido no ambiente de desenvolvimento (Ubuntu 24.04) |
| AppImage | `npm run package:appimage` | `release/PixelCraft-<versão>-x86_64.AppImage` | Gerado, extraído e executado no ambiente de desenvolvimento |
| Flatpak | `npm run package:flatpak` | `release/PixelCraft-<versão>.flatpak` | Gerado, instalado (por usuário) e iniciado no GitHub Actions; ver abaixo |

`npm run package:all` gera os três em sequência. `npm run verify:packages`
confere o que estiver em `release/` (veja [Verificação](#verificação)).

## Requisitos

* Linux x86_64, Node.js 22+ e npm 10+.
* `npm install` (instala também o Electron e o electron-builder).
* deb e AppImage: nada além disso. Na primeira vez o electron-builder baixa do
  GitHub as ferramentas `fpm` e `appimagetool` para a pasta de cache do usuário.
* Flatpak: `flatpak` e `flatpak-builder` (`sudo apt install flatpak flatpak-builder`)
  e acesso a `dl.flathub.org` na primeira vez, para baixar por usuário (sem root)
  o runtime `org.freedesktop.Platform//25.08`, o SDK e a base
  `org.electronjs.Electron2.BaseApp//25.08`.

Nenhum dos builds precisa de root. O aplicativo também não precisa de root para
rodar e não instala nada no sistema por conta própria.

## O que cada pacote instala

### .deb

* Aplicativo em `/opt/PixelCraft/` e o comando `pixelcraft` em `/usr/bin`
  (via `update-alternatives`).
* `/usr/share/applications/pixelcraft.desktop` com categoria
  `Graphics;2DGraphics;RasterGraphics;` e associação a `application/x-pixelcraft`.
* `/usr/share/mime/packages/pixelcraft.xml`: o tipo MIME `application/x-pixelcraft`
  para arquivos `*.pixelcraft`. O `postinst` roda `update-mime-database` e
  `update-desktop-database`, então o gerenciador de arquivos abre projetos com
  duplo clique.
* Ícones em `/usr/share/icons/hicolor/{16..512}/apps/pixelcraft.png`.
* Dependências declaradas: `libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6,
  xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0`.

Instalar e remover:

```bash
sudo apt install ./release/pixelcraft_0.1.0_amd64.deb
sudo apt remove pixelcraft
```

### AppImage

Arquivo único, sem instalação:

```bash
chmod +x PixelCraft-0.1.0-x86_64.AppImage
./PixelCraft-0.1.0-x86_64.AppImage
```

Precisa de FUSE 2 (`sudo apt install libfuse2` no Ubuntu 22.04+). Sem FUSE:
`./PixelCraft-0.1.0-x86_64.AppImage --appimage-extract-and-run`. A associação de
arquivos depende de uma ferramenta de integração (por exemplo AppImageLauncher
ou Gear Lever); o AppImage em si não altera o sistema.

### Flatpak

Arquivos em `packaging/flatpak/`:

* `io.github.leonardodevbb.PixelCraft.yml`: manifesto. Usa a base do Electron
  do Flathub e copia `release/linux-unpacked`.
* `io.github.leonardodevbb.PixelCraft.desktop` e `.metainfo.xml` (AppStream).
* `pixelcraft.sh`: inicia via `zypak-wrapper` (sandbox do Chromium sem setuid)
  com `GTK_USE_PORTAL=1` (diálogos de arquivo pelo portal).
* `packaging/linux/pixelcraft-mime.xml`: tipo MIME instalado dentro do Flatpak.

Permissões: `x11`, `wayland`, `dri`, `ipc` e acesso a Imagens, Documentos e
Downloads. **Sem rede.** Outros lugares do disco são acessíveis pelo seletor de
arquivos (portal).

Limitação conhecida no Flatpak: fora dessas três pastas, um arquivo escolhido
pelo portal é liberado sozinho. Exportações que gravam um segundo arquivo ao
lado do escolhido (o `.json` da spritesheet e o `.tmj` do tileset) só funcionam
dentro de Imagens, Documentos ou Downloads.

```bash
npm run package:flatpak
flatpak install --user release/PixelCraft-0.1.0.flatpak
flatpak run io.github.leonardodevbb.PixelCraft
```

**Onde é gerado:** no ambiente onde o projeto foi desenvolvido,
`dl.flathub.org` é bloqueado pela política de rede, então o Flatpak é gerado no
job `packages` do GitHub Actions (`.github/workflows/ci.yml`). Esse job roda
`scripts/build-flatpak.sh`, depois `scripts/verify-packages.sh --smoke
--flatpak-run`, que instala o pacote para o usuário do runner e o inicia
(`PIXELCRAFT_SMOKE_OK 0.1.0 flatpak`), e publica o `.flatpak` como artefato
`pixelcraft-linux`.

## Verificação

```bash
npm run verify:packages            # confere conteúdo de .deb, AppImage e .flatpak
bash scripts/verify-packages.sh --smoke         # e também inicia cada app
bash scripts/verify-packages.sh --flatpak-run   # instala o .flatpak (usuário) e inicia
```

O script não instala nada no sistema. Para o .deb e o AppImage ele extrai os
pacotes numa pasta temporária e confere: campos de controle, binário, `.desktop`
(com `desktop-file-validate` quando instalado), tipo MIME, ícones e o conteúdo
do `app.asar` (interface, processo principal e preload, sem `node_modules`).

`--smoke` executa `pixelcraft --smoke-test`. Nesse modo o app abre a janela,
confere que a tela inicial apareceu e que a ponte segura do preload existe,
imprime `PIXELCRAFT_SMOKE_OK <versão> <distribuição>` e sai. Sem display, o
script usa `xvfb-run`.

## Caminhos do usuário (XDG)

| Uso | Caminho |
|---|---|
| Preferências, paletas, atalhos | `$XDG_CONFIG_HOME/pixelcraft` (padrão `~/.config/pixelcraft`) |
| Recentes | `$XDG_DATA_HOME/pixelcraft` (padrão `~/.local/share/pixelcraft`) |
| Miniaturas, log e cache do Chromium | `$XDG_CACHE_HOME/pixelcraft` (padrão `~/.cache/pixelcraft`) |
| Recuperação (autosave) | `$XDG_DATA_HOME/pixelcraft/recovery` |

No Flatpak esses caminhos ficam dentro de `~/.var/app/io.github.leonardodevbb.PixelCraft/`.

## Detalhes do build

* Configuração: `electron-builder.yml`. Usa o Electron já instalado em
  `node_modules/electron/dist` (`electronDist`), sem baixar outro.
* Todo o código vai empacotado pelo Vite/esbuild em `dist/` e `dist-electron/`.
  Por isso todas as dependências estão em `devDependencies` e o `app.asar` não
  leva `node_modules`.
* Sem atualização automática (`publish: null`): atualizações chegam pelo
  gerenciador de pacotes ou por um AppImage novo.
* `desktopName` (`pixelcraft.desktop`) e `StartupWMClass=pixelcraft` fazem a
  janela aparecer com o ícone certo nas docas.
