#!/bin/bash
# Builds Paperlane.app — the web bundle plus a native AppKit shell.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
APP="$ROOT/build/Paperlane.app"
CONFIG="${1:-release}"

echo "==> Building the web app"
npm run build

echo "==> Laying out the bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp mac/Info.plist "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
cp -R dist/ "$APP/Contents/Resources/web/"

echo "==> Drawing the icon"
ICONSET="$ROOT/build/Paperlane.iconset"
rm -rf "$ICONSET"
swift mac/makeicon.swift "$ICONSET" > /dev/null
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

echo "==> Compiling the shell ($CONFIG)"
ARCH="$(uname -m)"
SWIFT_FLAGS=(-target "${ARCH}-apple-macosx13.0" -framework AppKit -framework WebKit -framework PDFKit -framework Network)
if [ "$CONFIG" = "debug" ]; then SWIFT_FLAGS+=(-Onone -g -D DEBUG); else SWIFT_FLAGS+=(-O); fi
swiftc "${SWIFT_FLAGS[@]}" mac/Sources/*.swift -o "$APP/Contents/MacOS/Paperlane"

echo "==> Signing (ad-hoc)"
codesign --force --deep --sign - "$APP"

echo
echo "Built $APP"
du -sh "$APP" | awk '{print "     size: " $1}'
echo "     open it with:  open build/Paperlane.app"
