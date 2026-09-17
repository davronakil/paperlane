#!/bin/bash
# Builds Paperlane and puts it in your Applications folder.
#
#   ./install.sh
#
# Checks what it needs first and tells you exactly how to get anything missing.

set -uo pipefail
cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
note() { printf '    %s\n' "$1"; }

fail() { printf '\n'; bold "Stopped."; printf '%s\n\n' "$1"; exit 1; }

bold "Checking what's needed"

# ---- macOS version --------------------------------------------------------
MAJOR=$(sw_vers -productVersion | cut -d. -f1)
if [ "$MAJOR" -lt 13 ]; then
  bad "macOS $(sw_vers -productVersion) — Paperlane needs macOS 13 (Ventura) or newer"
  fail "Please update macOS first."
fi
ok "macOS $(sw_vers -productVersion)"

# ---- Swift compiler (Command Line Tools is enough; full Xcode not needed) ---
# Ask swiftc directly: on a Mac with no tools this fails one way, and on one
# with a freshly installed Xcode whose licence is unsigned it fails another.
SWIFT_OUT=$(swiftc --version 2>&1)
SWIFT_RC=$?

if printf '%s' "$SWIFT_OUT" | grep -qi "license"; then
  bad "Xcode's licence has not been accepted yet"
  note "Run this (it will ask for your Mac password), then run ./install.sh again:"
  note ""
  note "    sudo xcodebuild -license accept"
  fail "macOS will not compile anything until that is agreed to."
fi

if [ $SWIFT_RC -ne 0 ] || ! printf '%s' "$SWIFT_OUT" | grep -qi "swift version"; then
  bad "Apple's command line developer tools are not installed"
  note "Run this, click Install in the window that appears, wait for it to"
  note "finish, then run ./install.sh again:"
  note ""
  note "    xcode-select --install"
  note ""
  note "It is a one-time download of about 1.5 GB. The full Xcode app, which"
  note "is far larger, is not needed."
  fail "Paperlane's window and menus are a small native app that has to be compiled."
fi
ok "Swift compiler ($(printf '%s' "$SWIFT_OUT" | head -1 | sed 's/.*Apple //'))"

# ---- Node.js --------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  bad "Node.js is not installed"
  note "Get the 'LTS' installer from https://nodejs.org and run it, or if you"
  note "use Homebrew:"
  note ""
  note "    brew install node"
  note ""
  note "Then run ./install.sh again."
  fail "Node is used to build the interface."
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
NODE_MINOR=$(node -v | sed 's/v[0-9]*\.\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  bad "Node $(node -v) is too old — 20.19 or newer is needed"
  note "Update from https://nodejs.org, or: brew upgrade node"
  fail "Then run ./install.sh again."
fi
ok "Node.js $(node -v)"

# ---- build ----------------------------------------------------------------
LOG=$(mktemp -t paperlane-install)
trap 'rm -f "$LOG"' EXIT

# Build steps are chatty and some of the noise looks alarming without being a
# problem, so keep it in a log and only show it if something actually breaks.
step() {
  local label="$1"; shift
  printf '  %s… ' "$label"
  if "$@" >"$LOG" 2>&1; then
    printf '\033[32mdone\033[0m\n'
  else
    printf '\033[31mfailed\033[0m\n\n'
    cat "$LOG"
    fail "$label failed. The output above says why."
  fi
}

printf '\n'
bold "Building Paperlane"
step "Fetching dependencies" npm install
step "Building the interface and the app" bash mac/build.sh
step "Installing to your Applications folder" bash mac/install.sh

printf '\n'
bold "Done"
note "Paperlane is in your Applications folder, in Spotlight, and under"
note "'Open With' for any PDF. Opening it now."
printf '\n'
open -a /Applications/Paperlane.app 2>/dev/null || true
