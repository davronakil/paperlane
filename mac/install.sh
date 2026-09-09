#!/bin/bash
# Copies build/Paperlane.app into /Applications, replacing any previous copy.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="$PWD/build/Paperlane.app"
DEST="/Applications/Paperlane.app"

[ -d "$SRC" ] || { echo "No build found — run 'npm run app' first."; exit 1; }

WAS_RUNNING=0
if pgrep -f "Paperlane.app/Contents/MacOS/Paperlane" > /dev/null; then
  WAS_RUNNING=1
  echo "==> Quitting the running copy"
  osascript -e 'quit app "Paperlane"' 2>/dev/null || true
  sleep 1
  pkill -f "Paperlane.app/Contents/MacOS/Paperlane" 2>/dev/null || true
  sleep 1
fi

echo "==> Installing to $DEST"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# Tell Launch Services about it now rather than whenever it next notices.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$DEST"

if [ "$WAS_RUNNING" = "1" ]; then
  echo "==> Reopening"
  open -a "$DEST"
  echo "Installed and reopened."
else
  echo "Installed. Open it with:  open -a Paperlane"
fi
