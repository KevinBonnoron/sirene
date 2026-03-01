#!/bin/bash
set -e

POCKETBASE_VERSION="${POCKETBASE_VERSION:-0.26.2}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)        PB_OS="linux" ;;
  darwin)       PB_OS="darwin" ;;
  mingw*|msys*|cygwin*) PB_OS="windows" ;;
  *)            echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64)        PB_ARCH="amd64" ;;
  aarch64|arm64) PB_ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

DEST_DIR="$(dirname "$0")/../vendor"
EXT=""
[ "$PB_OS" = "windows" ] && EXT=".exe"
DEST="$DEST_DIR/pocketbase${EXT}"

if [ -f "$DEST" ]; then
  echo "PocketBase already downloaded at $DEST"
  exit 0
fi

mkdir -p "$DEST_DIR"

URL="https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_${PB_OS}_${PB_ARCH}.zip"
echo "Downloading PocketBase v${POCKETBASE_VERSION} for ${PB_OS}/${PB_ARCH}..."
curl -fsSL "$URL" -o "$DEST_DIR/pocketbase.zip"
unzip -qo "$DEST_DIR/pocketbase.zip" "pocketbase${EXT}" -d "$DEST_DIR"
rm "$DEST_DIR/pocketbase.zip"
[ "$PB_OS" != "windows" ] && chmod +x "$DEST"
echo "PocketBase downloaded to $DEST"
