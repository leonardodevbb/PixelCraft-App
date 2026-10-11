#!/usr/bin/env bash
# Checks the packages in release/ without installing anything system-wide:
#   * .deb      – control fields, file list, .desktop, MIME, icons, app.asar
#   * AppImage  – extracts it (no FUSE needed) and checks the same things
#   * .flatpak  – bundle present (installation is optional, see --flatpak-run)
# With --smoke it also starts each extracted app with --smoke-test
# (uses xvfb-run when there is no display).
# With --flatpak-run it installs the bundle for the current user and runs it.
set -uo pipefail
cd "$(dirname "$0")/.."

SMOKE=0
FLATPAK_RUN=0
for a in "$@"; do
  case "$a" in
    --smoke) SMOKE=1 ;;
    --flatpak-run) FLATPAK_RUN=1 ;;
    *) echo "uso: $0 [--smoke] [--flatpak-run]" >&2; exit 2 ;;
  esac
done

VERSION=$(node -p "require('./package.json').version")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAIL=0
pass() { echo "  ok   $*"; }
fail() { echo "  FALHA $*"; FAIL=1; }
check_file() { [ -e "$1" ] && pass "$2" || fail "$2 ($1 ausente)"; }

asar_has_ui() {
  local list
  list=$(npx --no-install asar list "$1" 2>/dev/null) || { fail "app.asar ilegível"; return; }
  grep -qx '/dist/index.html' <<<"$list" && grep -qx '/dist-electron/main.cjs' <<<"$list" && grep -qx '/dist-electron/preload.cjs' <<<"$list" \
    && pass "app.asar contém interface, main e preload" || fail "app.asar incompleto"
  grep -q '^/node_modules/' <<<"$list" && fail "app.asar contém node_modules (deveria estar tudo empacotado)" || pass "app.asar sem node_modules"
}

validate_desktop() {
  if command -v desktop-file-validate >/dev/null 2>&1; then
    desktop-file-validate "$1" && pass "desktop-file-validate $(basename "$1")" || fail "desktop-file-validate $(basename "$1")"
  else
    echo "  --   desktop-file-validate não instalado (pulado)"
  fi
  grep -q '^MimeType=.*application/x-pixelcraft' "$1" && pass ".desktop associa application/x-pixelcraft" || fail ".desktop sem MimeType"
  grep -q '^Categories=.*Graphics' "$1" && pass ".desktop na categoria Graphics" || fail ".desktop sem categoria"
}

smoke() {
  local bin=$1 label=$2 out
  [ "$SMOKE" = 1 ] || return 0
  local args=(--smoke-test)
  [ "$(id -u)" = 0 ] && args+=(--no-sandbox)
  local run=()
  [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && run=(xvfb-run -a)
  out=$(HOME="$WORK/home-$label" PIXELCRAFT_MULTI_INSTANCE=1 timeout 90 "${run[@]}" "$bin" "${args[@]}" 2>&1 | grep PIXELCRAFT_SMOKE)
  [[ "$out" == PIXELCRAFT_SMOKE_OK* ]] && pass "inicia ($out)" || fail "não iniciou: ${out:-sem saída}"
}

DEB=release/pixelcraft_${VERSION}_amd64.deb
if [ -f "$DEB" ]; then
  echo "== $DEB ($(du -h "$DEB" | cut -f1))"
  dpkg-deb -I "$DEB" >"$WORK/control" || fail "dpkg-deb -I"
  grep -q "^ Package: pixelcraft" "$WORK/control" && pass "Package: pixelcraft" || fail "nome do pacote"
  grep -q "^ Version: $VERSION" "$WORK/control" && pass "Version: $VERSION" || fail "versão"
  grep -q "^ Depends: .*libgtk-3-0" "$WORK/control" && pass "Depends declarado" || fail "Depends"
  mkdir -p "$WORK/deb" && dpkg-deb -x "$DEB" "$WORK/deb"
  R=$WORK/deb
  check_file "$R/opt/PixelCraft/pixelcraft" "binário em /opt/PixelCraft"
  check_file "$R/usr/share/applications/pixelcraft.desktop" ".desktop"
  check_file "$R/usr/share/mime/packages/pixelcraft.xml" "tipo MIME .pixelcraft"
  check_file "$R/usr/share/icons/hicolor/256x256/apps/pixelcraft.png" "ícone 256 px"
  check_file "$R/opt/PixelCraft/resources/icon.png" "ícone da janela"
  [ -f "$R/usr/share/applications/pixelcraft.desktop" ] && validate_desktop "$R/usr/share/applications/pixelcraft.desktop"
  asar_has_ui "$R/opt/PixelCraft/resources/app.asar"
  smoke "$R/opt/PixelCraft/pixelcraft" deb
else
  echo "== .deb não encontrado ($DEB); rode npm run package:deb"
fi

APPIMAGE=release/PixelCraft-${VERSION}-x86_64.AppImage
if [ -f "$APPIMAGE" ]; then
  echo "== $APPIMAGE ($(du -h "$APPIMAGE" | cut -f1))"
  [ -x "$APPIMAGE" ] && pass "executável" || fail "sem permissão de execução"
  (cd "$WORK" && "$OLDPWD/$APPIMAGE" --appimage-extract >/dev/null 2>&1) || fail "--appimage-extract"
  R=$WORK/squashfs-root
  check_file "$R/AppRun" "AppRun"
  check_file "$R/pixelcraft.desktop" ".desktop"
  check_file "$R/pixelcraft.png" "ícone"
  [ -f "$R/pixelcraft.desktop" ] && validate_desktop "$R/pixelcraft.desktop"
  asar_has_ui "$R/resources/app.asar"
  smoke "$R/AppRun" appimage
else
  echo "== AppImage não encontrado ($APPIMAGE); rode npm run package:appimage"
fi

FLATPAK=release/PixelCraft-${VERSION}.flatpak
if [ -f "$FLATPAK" ]; then
  echo "== $FLATPAK ($(du -h "$FLATPAK" | cut -f1))"
  pass "pacote presente"
  if [ "$FLATPAK_RUN" = 1 ]; then
    flatpak install --user --noninteractive --reinstall "$FLATPAK" >/dev/null && pass "instalado (usuário)" || fail "flatpak install"
    out=$(timeout 90 flatpak run io.github.leonardodevbb.PixelCraft --smoke-test 2>&1 | grep PIXELCRAFT_SMOKE)
    [[ "$out" == PIXELCRAFT_SMOKE_OK* ]] && pass "inicia ($out)" || fail "não iniciou: ${out:-sem saída}"
  fi
else
  echo "== Flatpak não encontrado ($FLATPAK); rode npm run package:flatpak"
fi

if command -v appstreamcli >/dev/null 2>&1; then
  echo "== metainfo"
  appstreamcli validate --no-net packaging/flatpak/io.github.leonardodevbb.PixelCraft.metainfo.xml && pass "AppStream válido" || fail "AppStream"
fi
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate packaging/flatpak/io.github.leonardodevbb.PixelCraft.desktop && pass ".desktop do Flatpak válido" || fail ".desktop do Flatpak"
fi

echo
[ "$FAIL" = 0 ] && echo "Tudo certo." || echo "Há falhas acima."
exit "$FAIL"
