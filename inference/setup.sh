#!/usr/bin/env bash
# Post-install setup for inference dependencies that can't go in pyproject.toml.
# Called by both the devcontainer postCreateCommand and the Dockerfile.
set -euo pipefail

PIP="${PIP:-pip}"

# chatterbox-tts pins numpy<1.26 and transformers==4.46.3 which conflicts
# with other backends. Only the package itself needs --no-deps; its transitive
# deps (resemble-perth, pykakasi, etc.) are declared in pyproject.toml.
# s3tokenizer pulls onnx which requires protoc to build from source — skip it,
# onnxruntime (already installed) provides what we need at runtime.
$PIP install --no-deps chatterbox-tts s3tokenizer

# flash-attn needs torch at build time and nvcc (CUDA toolkit) to compile from
# source — no pre-built wheels on PyPI. Install only when both CUDA torch and
# nvcc are available; skip gracefully otherwise (backends fall back to the
# manual PyTorch attention implementation).
if python3 -c "import torch; exit(0 if torch.version.cuda else 1)" 2>/dev/null \
   && command -v nvcc >/dev/null 2>&1; then
    $PIP install --no-build-isolation flash-attn || echo "WARNING: flash-attn build failed, skipping"
fi

# spaCy model for text processing (install directly to avoid spacy calling pip)
$PIP install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# The PyPI cosyvoice package is incomplete (missing cli, utils, flow, etc.).
# Overlay the real source from FunAudioLLM, including its Matcha-TTS submodule.
SITE_PKG=$(python3 -c "import sysconfig; print(sysconfig.get_path('purelib'))")
git clone --depth=1 --recursive --filter=blob:none \
    https://github.com/FunAudioLLM/CosyVoice.git /tmp/cosyvoice
mkdir -p "$SITE_PKG/cosyvoice" "$SITE_PKG/matcha"
cp -r /tmp/cosyvoice/cosyvoice/* "$SITE_PKG/cosyvoice/"
cp -r /tmp/cosyvoice/third_party/Matcha-TTS/matcha/* "$SITE_PKG/matcha/"
rm -rf /tmp/cosyvoice
