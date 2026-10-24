#!/bin/bash
# Runs Category Grid in an isolated headless GNOME Shell and saves screenshots
# to test/shots. Your real session, settings and app usage data are untouched.
#
# usage: test/run.sh [WxH]   (default 1920x1080)
# Optional environment:
#   MODE=ubuntu               session mode (Ubuntu: Yaru theme and Ubuntu Dock)
#   DOCK=<uuid>               dock extension to enable, e.g. dash-to-dock@micxgx.gmail.com
#   SCALE=1.5                 monitor scale
#   COLOR_SCHEME=prefer-light|prefer-dark, HIGH_CONTRAST=true, TEXT_SCALE=1.5
set -euo pipefail

SIZE=${1:-1920x1080}
REPO=$(cd "$(dirname "$0")/.." && pwd)
DRIVER="$REPO/test/category-grid-test@the753q.github.io"
SHOTS=${SHOTS:-$REPO/test/shots}
LOG=${LOG:-$REPO/test/shell.log}
# Short path: the Wayland socket path must fit in 108 bytes.
ENV_DIR=$(mktemp -d /tmp/cg-test.XXXXXX)
cleanup() {
    # The test session's document portal may still hold its FUSE mount.
    fusermount3 -uz "$ENV_DIR/run/doc" 2>/dev/null || true
    rm -rf "$ENV_DIR" 2>/dev/null || { sleep 1; rm -rf "$ENV_DIR"; }
}
trap cleanup EXIT

mkdir -p "$ENV_DIR"/{config,cache,run,data/gnome-shell/extensions} "$SHOTS"
chmod 700 "$ENV_DIR/run"
rm -f "$SHOTS"/*.png

# Real apps and usage stats (copied, so the test shell cannot overwrite them).
cp -r ~/.local/share/applications "$ENV_DIR/data/" 2>/dev/null || true
cp ~/.local/share/gnome-shell/application_state "$ENV_DIR/data/gnome-shell/" 2>/dev/null || true
ln -s "$REPO" "$ENV_DIR/data/gnome-shell/extensions/category-grid@the753q.github.io"
ln -s "$DRIVER" "$ENV_DIR/data/gnome-shell/extensions/category-grid-test@the753q.github.io"

EXTENSIONS="\"category-grid@the753q.github.io\", \"category-grid-test@the753q.github.io\""
[ -n "${DOCK:-}" ] && EXTENSIONS="\"$DOCK\", $EXTENSIONS"

export EXTENSIONS SIZE MODE_ARG=${MODE:+--mode=$MODE} SCALE=${SCALE:-}
export CG_BG="$(gsettings get org.gnome.desktop.background picture-uri 2>/dev/null || echo "''")"
export CG_SHOTS="$SHOTS"
export COLOR_SCHEME=${COLOR_SCHEME:-default} HIGH_CONTRAST=${HIGH_CONTRAST:-false} TEXT_SCALE=${TEXT_SCALE:-1.0}
export XDG_CONFIG_HOME="$ENV_DIR/config" XDG_CACHE_HOME="$ENV_DIR/cache"
export XDG_DATA_HOME="$ENV_DIR/data" XDG_RUNTIME_DIR="$ENV_DIR/run"
unset WAYLAND_DISPLAY DISPLAY

dbus-run-session -- bash -c '
# Containers have no system bus; GNOME Shell aborts without one.
[ -S /run/dbus/system_bus_socket ] || export DBUS_SYSTEM_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"
dconf write /org/gnome/shell/enabled-extensions "[$EXTENSIONS]"
dconf write /org/gnome/shell/disable-user-extensions false
dconf write /org/gnome/shell/welcome-dialog-last-shown-version "\"999\""
dconf write /org/gnome/desktop/background/picture-uri "$CG_BG"
dconf write /org/gnome/desktop/background/picture-uri-dark "$CG_BG"
dconf write /org/gnome/desktop/interface/color-scheme "\"$COLOR_SCHEME\""
dconf write /org/gnome/desktop/a11y/interface/high-contrast "$HIGH_CONTRAST"
dconf write /org/gnome/desktop/interface/text-scaling-factor "$TEXT_SCALE"
if [ -n "$SCALE" ]; then
    (sleep 2; gdctl set -l logical -L -p -M Meta-0 -s "$SCALE" || echo "CGTEST gdctl failed") &
fi
timeout 120 gnome-shell --headless --no-x11 $MODE_ARG --virtual-monitor "$SIZE"
' > "$LOG" 2>&1 || true

grep -E 'CGTEST|JS ERROR|JS WARNING' "$LOG" | grep -v 'CGTEST category' | sed 's/^.*CGTEST/CGTEST/'
echo "Screenshots: $SHOTS"
