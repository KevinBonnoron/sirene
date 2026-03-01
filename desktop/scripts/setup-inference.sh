#!/bin/bash
set -e

PYTHON_VERSION="3.11.11"
PYTHON_BUILD_STANDALONE_TAG="20250317"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)        PY_OS="unknown-linux-gnu" ;;
  darwin)       PY_OS="apple-darwin" ;;
  mingw*|msys*|cygwin*) PY_OS="pc-windows-msvc" ;;
  *)            echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64)        PY_ARCH="x86_64" ;;
  aarch64|arm64) PY_ARCH="aarch64" ;;
  *)             echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$DESKTOP_DIR")"
VENDOR_DIR="$DESKTOP_DIR/vendor"
PYTHON_DIR="$VENDOR_DIR/python"

# Step 1: Download python-build-standalone if needed
if [ "$PY_OS" = "pc-windows-msvc" ]; then
  PYTHON_BIN="$PYTHON_DIR/python.exe"
else
  PYTHON_BIN="$PYTHON_DIR/bin/python3"
fi

if [ ! -f "$PYTHON_BIN" ]; then
  echo "=== Downloading Python ${PYTHON_VERSION} standalone ==="
  mkdir -p "$VENDOR_DIR"

  FILENAME="cpython-${PYTHON_VERSION}+${PYTHON_BUILD_STANDALONE_TAG}-${PY_ARCH}-${PY_OS}-install_only_stripped.tar.gz"
  URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD_STANDALONE_TAG}/${FILENAME}"

  echo "Downloading from: $URL"
  curl -fsSL "$URL" -o "$VENDOR_DIR/python.tar.gz"
  tar -xzf "$VENDOR_DIR/python.tar.gz" -C "$VENDOR_DIR"
  rm "$VENDOR_DIR/python.tar.gz"
  echo "Python downloaded"
fi

echo "Using Python: $($PYTHON_BIN --version)"

# Step 2: Install uv if needed
if ! command -v uv &>/dev/null; then
  echo "=== Installing uv ==="
  if [ "$PY_OS" = "pc-windows-msvc" ]; then
    "$PYTHON_BIN" -m pip install uv --quiet
    export PATH="$PYTHON_DIR/Scripts:$PATH"
  else
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi
fi

# Step 3: Install core inference dependencies into the standalone Python
# Heavy backend deps (torch, transformers, etc.) are installed lazily at runtime
# via the /backends/{name}/install endpoint into SIRENE_PACKAGES_DIR (~/.sirene/packages)
if ! $PYTHON_BIN -c "import fastapi" 2>/dev/null; then
  echo "=== Installing core inference dependencies ==="

  if [ "$PY_OS" = "pc-windows-msvc" ]; then
    INFERENCE_PATH=$(cd "$PROJECT_ROOT/inference" && pwd -W)
    OVERRIDES_PATH=$(cd "$PROJECT_ROOT/inference" && pwd -W)/overrides.txt
  else
    INFERENCE_PATH="$PROJECT_ROOT/inference"
    OVERRIDES_PATH="$PROJECT_ROOT/inference/overrides.txt"
  fi

  uv pip install --python "$PYTHON_BIN" \
    --override "$OVERRIDES_PATH" \
    "${INFERENCE_PATH}"
else
  echo "=== Core inference dependencies already installed ==="
fi

echo "=== Inference environment ready ==="
