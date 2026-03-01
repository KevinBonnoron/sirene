# syntax=docker/dockerfile:1

# ── PocketBase binary (per target platform) ──────────────────────────────────

FROM alpine:latest AS binary-downloader

ARG POCKETBASE_VERSION=0.26.2
ARG TARGETARCH

WORKDIR /tmp

RUN --mount=type=cache,target=/var/cache/apk \
    apk add curl unzip \
    && ARCH=$(case "$TARGETARCH" in \
        arm64) echo "linux_arm64" ;; \
        amd64) echo "linux_amd64" ;; \
        *) echo "Unsupported architecture: $TARGETARCH" >&2 && exit 1 ;; \
    esac) \
    && curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_${ARCH}.zip" -o pocketbase.zip \
    && unzip -q pocketbase.zip \
    && chmod +x pocketbase \
    && rm pocketbase.zip

# ── Bun binary (per target platform) ─────────────────────────────────────────

FROM oven/bun:1.2.4 AS bun-bin

# ── Inference Python dependencies ────────────────────────────────────────────

FROM python:3.11-slim-bookworm AS inference-deps

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ARG INFERENCE_VARIANT=cpu

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential portaudio19-dev cmake git \
    && if [ "$INFERENCE_VARIANT" = "cuda" ]; then \
        apt-get install -y --no-install-recommends wget \
        && wget -qO /tmp/cuda-keyring.deb \
            https://developer.download.nvidia.com/compute/cuda/repos/debian12/x86_64/cuda-keyring_1.1-1_all.deb \
        && dpkg -i /tmp/cuda-keyring.deb \
        && rm /tmp/cuda-keyring.deb \
        && apt-get update \
        && apt-get install -y --no-install-recommends \
            cuda-nvcc-12-4 cuda-cudart-dev-12-4; \
    fi

ENV PATH="/usr/local/cuda/bin:${PATH}"

WORKDIR /app/inference

COPY inference/pyproject.toml inference/overrides.txt inference/setup.sh ./

ARG TARGETARCH
RUN --mount=type=cache,target=/root/.cache/uv,id=uv-${INFERENCE_VARIANT}-${TARGETARCH},sharing=locked \
    uv venv --seed /opt/inference-venv \
    && UV_EXTRA_ARGS="" \
    && if [ "$INFERENCE_VARIANT" = "cpu" ]; then \
         UV_EXTRA_ARGS="--extra-index-url https://download.pytorch.org/whl/cpu"; \
       fi \
    && uv pip install --python /opt/inference-venv/bin/python --override overrides.txt $UV_EXTRA_ARGS ".[$INFERENCE_VARIANT]" \
    && uv pip install --python /opt/inference-venv/bin/python "fish-speech==0.1.0" --no-deps \
    && PATH="/opt/inference-venv/bin:$PATH" PIP="/opt/inference-venv/bin/pip" ./setup.sh \
    && (find /opt/inference-venv -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true) \
    && (find /opt/inference-venv -name "*.pyc" -delete 2>/dev/null || true) \
    && (find /opt/inference-venv -name "*.pyo" -delete 2>/dev/null || true)

# ── Final image ──────────────────────────────────────────────────────────────

FROM python:3.11-slim-bookworm AS final

ARG INFERENCE_VARIANT=cpu
ENV INFERENCE_DEVICE=${INFERENCE_VARIANT}

# NVIDIA container runtime: expose GPUs when available.
# Harmless on CPU-only hosts (the runtime simply ignores them).
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        nginx supervisor libsndfile1 espeak-ng ffmpeg sox \
    && rm -f /etc/nginx/sites-enabled/default \
    && mkdir -p /var/log/supervisor /app/db/pb_data /app/data/models

WORKDIR /app

COPY server/dist/index.js ./server/dist/index.js
COPY client/dist /usr/share/nginx/html
COPY db/pb_migrations /app/db/pb_migrations

COPY --from=inference-deps /opt/inference-venv /opt/inference-venv
COPY inference/src /app/inference/src

COPY --from=binary-downloader /tmp/pocketbase /usr/local/bin/pocketbase

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
