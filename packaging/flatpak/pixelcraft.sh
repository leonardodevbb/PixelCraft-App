#!/bin/sh
# Launcher inside the Flatpak sandbox. zypak lets Chromium's sandbox work
# without setuid helpers; portals provide the native file dialogs.
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
export GTK_USE_PORTAL=1
exec zypak-wrapper /app/pixelcraft/pixelcraft --ozone-platform-hint=auto "$@"
