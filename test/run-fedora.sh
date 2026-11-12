#!/bin/bash
# Runs test/run.sh inside a Fedora container, i.e. on upstream GNOME without
# Ubuntu's patches. Needs podman or docker. Screenshots go to test/shots-fedora.
#
# usage: test/run-fedora.sh [WxH]   (same environment variables as test/run.sh,
#                                    plus FEDORA=45 for another Fedora release)
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
ENGINE=$(command -v podman || command -v docker)
FEDORA=${FEDORA:-44}
IMAGE=category-grid-test-fedora:$FEDORA
OUT="$REPO/test/shots-fedora"
mkdir -p "$OUT"

"$ENGINE" build -q -t "$IMAGE" --build-arg FEDORA="$FEDORA" -f "$REPO/test/fedora.Containerfile" "$REPO/test" >/dev/null

"$ENGINE" run --rm \
    -v "$REPO:/repo:ro" -v "$OUT:/out" \
    -e SHOTS=/out -e LOG=/out/shell.log \
    -e MODE -e DOCK -e SCALE -e COLOR_SCHEME -e HIGH_CONTRAST -e TEXT_SCALE \
    "$IMAGE" /repo/test/run.sh "$@"
