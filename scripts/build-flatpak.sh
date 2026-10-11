#!/usr/bin/env bash
# Builds release/PixelCraft-<version>.flatpak (a single-file bundle).
#
# Needs: flatpak and flatpak-builder (e.g. `sudo apt install flatpak flatpak-builder`),
# network access to Flathub the first time (runtime, SDK and Electron base app,
# installed per user, no root), and `npm run build` already done (package:flatpak does it).
set -euo pipefail
cd "$(dirname "$0")/.."

APP_ID=io.github.leonardodevbb.PixelCraft
MANIFEST=packaging/flatpak/$APP_ID.yml
VERSION=$(node -p "require('./package.json').version")
BUNDLE=release/PixelCraft-$VERSION.flatpak
RUNTIME_VERSION=25.08

for tool in flatpak flatpak-builder; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "erro: '$tool' não encontrado. Instale com: sudo apt install flatpak flatpak-builder (ou o equivalente da sua distribuição)." >&2
    exit 1
  fi
done

# Same app files as the .deb/AppImage.
if [ ! -x release/linux-unpacked/pixelcraft ]; then
  echo "==> Gerando release/linux-unpacked com electron-builder"
  npx electron-builder --linux dir
fi

echo "==> Garantindo runtime, SDK e base do Electron ($RUNTIME_VERSION) do Flathub (por usuário)"
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user --noninteractive --or-update flathub \
  "org.freedesktop.Platform//$RUNTIME_VERSION" \
  "org.freedesktop.Sdk//$RUNTIME_VERSION" \
  "org.electronjs.Electron2.BaseApp//$RUNTIME_VERSION"

echo "==> flatpak-builder"
mkdir -p build-flatpak release
flatpak-builder --user --force-clean --disable-rofiles-fuse \
  --state-dir=build-flatpak/state \
  --repo=build-flatpak/repo \
  build-flatpak/app "$MANIFEST"

echo "==> Gerando o pacote $BUNDLE"
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  build-flatpak/repo "$BUNDLE" "$APP_ID"
ls -lh "$BUNDLE"
echo "Instalar: flatpak install --user $BUNDLE"
