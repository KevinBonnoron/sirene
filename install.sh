#!/usr/bin/env bash
set -euo pipefail

# ── Sirene installer ────────────────────────────────────────────────────────
# Usage:
#   curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | bash
#
# Modes (interactive prompt by default; skip with INSTALL_MODE):
#   full    — server + inference on this machine [default]
#   server  — just the app, configure inference workers via the UI
#   worker  — just the inference, prints URL + auth token
#
# Optional env vars:
#   INSTALL_MODE   full|server|worker
#   DEVICE         cpu|cuda                (full / worker only — auto-detected if unset)
#   INFERENCE_URL  http://...               (server mode only — seeds the registry at boot)
#   PORT           default 8000             (worker mode only)
#   SERVER_URL     default detected via hostname -I (worker mode only)
#   IMAGE          override the inference image (worker mode only)
#   DATA_DIR       override where models/packages live on disk
#                  default: <install dir>/data
# ─────────────────────────────────────────────────────────────────────────────

REPO="ghcr.io/kevinbonnoron/sirene"
INSTALL_DIR="sirene"
INFERENCE_PORT="${PORT:-8000}"
NETWORK_NAME="sirene-net"

BORDER="─────────────────────────────────────────────"
CYAN="\033[36m"
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
BOLD="\033[1m"
DIM="\033[2m"
RESET="\033[0m"

die()  { printf "${RED}error:${RESET} %s\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}→${RESET} %s\n" "$1"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$1"; }

printf "\n"
printf "  ${CYAN}┌${BORDER}┐${RESET}\n"
printf "  ${CYAN}│${RESET}${BOLD}              Sirene Installer               ${CYAN}│${RESET}\n"
printf "  ${CYAN}│${RESET}${DIM}          Multi-backend TTS Router           ${CYAN}│${RESET}\n"
printf "  ${CYAN}└${BORDER}┘${RESET}\n"
printf "\n"

# ── Privilege ───────────────────────────────────────────────────────────────

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || die "this script needs root or sudo"
  SUDO="sudo"
fi

# ── Distro / GPU detection ──────────────────────────────────────────────────

DISTRO_ID=""
DISTRO_LIKE=""
if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO_ID="${ID:-}"
  DISTRO_LIKE="${ID_LIKE:-}"
fi

is_debian_like() {
  case "${DISTRO_ID}${DISTRO_LIKE}" in
    *ubuntu*|*debian*) return 0 ;;
    *) return 1 ;;
  esac
}

HAS_GPU=0
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  HAS_GPU=1
fi

# ── Prerequisites ───────────────────────────────────────────────────────────

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    ok "Docker present"
  elif is_debian_like; then
    info "installing Docker..."
    curl -fsSL https://get.docker.com | $SUDO sh
    ok "Docker installed"
  else
    die "Docker is not installed. See https://docs.docker.com/engine/install/ for your distro."
  fi
  $SUDO docker info >/dev/null 2>&1 || die "Docker daemon is not running"
}

ensure_nvidia_toolkit() {
  if ! is_debian_like; then
    die "NVIDIA container toolkit auto-install is only supported on Ubuntu/Debian. Install manually then re-run."
  fi
  if $SUDO docker info 2>/dev/null | grep -q nvidia; then
    ok "nvidia runtime already configured"
    return 0
  fi
  info "installing nvidia-container-toolkit..."
  KEYRING=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | $SUDO gpg --batch --yes --dearmor -o "$KEYRING"
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by='"$KEYRING"'] https://#g' \
    | $SUDO tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
  $SUDO apt-get update -qq
  $SUDO apt-get install -y nvidia-container-toolkit >/dev/null
  $SUDO nvidia-ctk runtime configure --runtime=docker
  $SUDO systemctl restart docker
  ok "nvidia-container-toolkit configured"
}

ensure_network() {
  if ! $SUDO docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    $SUDO docker network create "$NETWORK_NAME" >/dev/null
  fi
}

remove_container() {
  local name="$1"
  if $SUDO docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
    $SUDO docker rm -f "$name" >/dev/null
  fi
}

# ── Pick install mode ───────────────────────────────────────────────────────

INSTALL_MODE="${INSTALL_MODE:-}"
if [ -z "$INSTALL_MODE" ]; then
  printf "${BOLD}What do you want to install?${RESET}\n"
  printf "  ${CYAN}1)${RESET} Sirene             ${DIM}server + inference on this machine (default)${RESET}\n"
  printf "  ${CYAN}2)${RESET} Sirene server      ${DIM}just the app, add inference via the UI${RESET}\n"
  printf "  ${CYAN}3)${RESET} Inference worker   ${DIM}extend an existing Sirene with another inference${RESET}\n"
  printf "${YELLOW}Choice [1]:${RESET} "
  read -r CHOICE </dev/tty
  case "$CHOICE" in
    2) INSTALL_MODE="server" ;;
    3) INSTALL_MODE="worker" ;;
    *) INSTALL_MODE="full" ;;
  esac
fi

case "$INSTALL_MODE" in
  full|server|worker) ;;
  *) die "unknown INSTALL_MODE \"$INSTALL_MODE\" — expected full / server / worker" ;;
esac

# ── Pick device (full / worker only) ────────────────────────────────────────

DEVICE="${DEVICE:-}"
if [ "$INSTALL_MODE" = "full" ] || [ "$INSTALL_MODE" = "worker" ]; then
  if [ -z "$DEVICE" ]; then
    DEFAULT_DEVICE=$([ $HAS_GPU -eq 1 ] && echo cuda || echo cpu)
    printf "${BOLD}Inference device?${RESET}\n"
    if [ $HAS_GPU -eq 1 ]; then
      GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>/dev/null | head -n1)
      printf "  ${CYAN}1)${RESET} CPU\n"
      printf "  ${CYAN}2)${RESET} CUDA               ${DIM}detected: ${GPU_NAME}${RESET}\n"
      printf "${YELLOW}Choice [2]:${RESET} "
    else
      printf "  ${CYAN}1)${RESET} CPU                ${DIM}no NVIDIA GPU detected${RESET}\n"
      printf "  ${CYAN}2)${RESET} CUDA\n"
      printf "${YELLOW}Choice [1]:${RESET} "
    fi
    read -r CHOICE </dev/tty
    case "$CHOICE" in
      1) DEVICE="cpu" ;;
      2) DEVICE="cuda" ;;
      *) DEVICE="$DEFAULT_DEVICE" ;;
    esac
  fi
  case "$DEVICE" in
    cpu|cuda) ;;
    *) die "unknown DEVICE \"$DEVICE\" — expected cpu / cuda" ;;
  esac
fi

ensure_docker
[ "${DEVICE:-}" = "cuda" ] && ensure_nvidia_toolkit

# ── Install dir + data dir (shared by all modes) ────────────────────────────

if [ -d "$INSTALL_DIR" ]; then
  echo "Directory '$INSTALL_DIR' already exists."
  printf "Overwrite configuration? [y/N]: "
  read -r OVERWRITE </dev/tty
  case "$OVERWRITE" in
    [yY]*) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

RAW_DATA_DIR="${DATA_DIR:-$(pwd)/data}"
case "$RAW_DATA_DIR" in
  /*) DATA_DIR_ABS="$RAW_DATA_DIR" ;;
  *)  DATA_DIR_ABS="$(pwd)/$RAW_DATA_DIR" ;;
esac

# ── Mode: worker ────────────────────────────────────────────────────────────

if [ "$INSTALL_MODE" = "worker" ]; then
  mkdir -p "$DATA_DIR_ABS/models" "$DATA_DIR_ABS/packages"

  IMAGE="${IMAGE:-${REPO}-inference:$([ "$DEVICE" = "cuda" ] && echo cuda || echo latest)}"

  remove_container sirene-inference

  # Reuse the existing token on reinstall so server entries already registered
  # with this worker keep working — rotating here would silently break every
  # server pointing at this URL. A non-empty file with only whitespace would
  # otherwise produce an empty AUTH_TOKEN and boot the worker fail-closed.
  if [ -s auth_token ]; then
    AUTH_TOKEN=$(tr -d '\n\r' < auth_token)
  fi
  if [ -n "${AUTH_TOKEN:-}" ]; then
    ok "reusing auth token from $(pwd)/auth_token (mode 600)"
  else
    if command -v openssl >/dev/null 2>&1; then
      AUTH_TOKEN=$(openssl rand -hex 32)
    else
      AUTH_TOKEN=$(head -c 32 /dev/urandom | xxd -p -c 64)
    fi
    ( umask 077 && printf '%s\n' "$AUTH_TOKEN" > auth_token )
    ok "saved auth token to $(pwd)/auth_token (mode 600)"
  fi

  info "pulling $IMAGE ..."
  $SUDO docker pull "$IMAGE" >/dev/null

  GPU_ARGS=""
  [ "$DEVICE" = "cuda" ] && GPU_ARGS="--gpus all"

  info "starting sirene-inference on port $INFERENCE_PORT ..."
  # shellcheck disable=SC2086
  $SUDO docker run -d \
    --name sirene-inference \
    --restart unless-stopped \
    -p "${INFERENCE_PORT}:8000" \
    -e INFERENCE_AUTH_TOKEN="$AUTH_TOKEN" \
    -v "${DATA_DIR_ABS}/models:/app/data/models" \
    -v "${DATA_DIR_ABS}/packages:/app/data/packages" \
    $GPU_ARGS \
    "$IMAGE" >/dev/null

  info "waiting for the inference server to become healthy..."
  for _ in $(seq 1 60); do
    if curl -fsS "http://localhost:${INFERENCE_PORT}/health" >/dev/null 2>&1; then
      ok "inference server is up"
      break
    fi
    sleep 2
  done
  if ! curl -fsS "http://localhost:${INFERENCE_PORT}/health" >/dev/null 2>&1; then
    echo
    $SUDO docker logs --tail=50 sirene-inference || true
    die "inference server did not become healthy within 2 minutes"
  fi

  if [ -z "${SERVER_URL:-}" ]; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -n "$IP" ]; then
      SERVER_URL="http://${IP}:${INFERENCE_PORT}"
    else
      SERVER_URL="http://<your-host>:${INFERENCE_PORT}"
    fi
  fi

  echo
  printf "  ${GREEN}${BOLD}Worker installed.${RESET}\n"
  printf "  ${DIM}Paste these into Sirene → Settings → Inference servers → Add server:${RESET}\n"
  echo
  printf "    ${YELLOW}URL${RESET}        %s\n" "$SERVER_URL"
  printf "    ${YELLOW}Auth token${RESET} %s\n" "$AUTH_TOKEN"
  echo
  printf "  ${DIM}Models:${RESET} %s\n" "$DATA_DIR_ABS"
  printf "  ${DIM}Token:${RESET}  %s\n" "$(pwd)/auth_token"
  printf "  ${DIM}Logs:${RESET}   docker logs -f sirene-inference\n"
  echo
  exit 0
fi

# ── Mode: full / server (server container, optional inference) ──────────────

PB_DATA_HAS_CONTENT=0
if [ -d "$DATA_DIR_ABS/pb_data" ] && [ -n "$(ls -A "$DATA_DIR_ABS/pb_data" 2>/dev/null)" ]; then
  PB_DATA_HAS_CONTENT=1
fi
mkdir -p "$DATA_DIR_ABS/pb_data"
[ "$INSTALL_MODE" = "full" ] && mkdir -p "$DATA_DIR_ABS/models" "$DATA_DIR_ABS/packages"

PB_SUPERUSER_EMAIL="admin@sirene.local"

# Read a single KEY=VALUE pair from the credentials file without sourcing it.
# Sourcing executes whatever sh code happens to be in the file, which is unsafe
# for a path that's already on disk by the time we get here.
read_cred() {
  local key="$1"
  local file="$2"
  [ -f "$file" ] || return 1
  awk -v k="$key" -F= '
    /^[[:space:]]*#/ || $1 ~ /^[[:space:]]*$/ { next }
    {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1)
      if ($1 == k) {
        sub(/^[^=]*=/, "")
        # strip surrounding quotes if present
        gsub(/^["'\'']|["'\'']$/, "")
        print
        exit
      }
    }
  ' "$file"
}

# On a reinstall PB still uses the admin account that was stored in pb_data, so
# rotating the password here would print credentials that no longer work. Reuse
# the saved credentials when available; if pb_data exists without a credentials
# file, leave the user to recover it manually rather than silently overwriting.
if [ -f credentials ]; then
  EXISTING_EMAIL=$(read_cred PB_SUPERUSER_EMAIL credentials || true)
  EXISTING_PASSWORD=$(read_cred PB_SUPERUSER_PASSWORD credentials || true)
  if [ -n "$EXISTING_PASSWORD" ]; then
    PB_PASSWORD="$EXISTING_PASSWORD"
    PB_SUPERUSER_EMAIL="${EXISTING_EMAIL:-$PB_SUPERUSER_EMAIL}"
    ok "reusing PocketBase credentials from $(pwd)/credentials"
  fi
fi

if [ -z "${PB_PASSWORD:-}" ]; then
  if [ "$PB_DATA_HAS_CONTENT" = "1" ]; then
    printf "${YELLOW}warning:${RESET} pb_data already exists but no credentials file was found.\n"
    printf "         Skipping password generation — recover the existing admin via PB Admin UI\n"
    printf "         or remove %s to start fresh.\n" "$DATA_DIR_ABS/pb_data"
    PB_PASSWORD=""
  else
    PB_PASSWORD=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
    ( umask 077 && cat > credentials <<EOF
PB_SUPERUSER_EMAIL=${PB_SUPERUSER_EMAIL}
PB_SUPERUSER_PASSWORD=${PB_PASSWORD}
EOF
    )
    ok "saved PocketBase credentials to $(pwd)/credentials (mode 600)"
  fi
fi

ensure_network

# Inference (full mode only) — runs first so the server can talk to it on the network.
if [ "$INSTALL_MODE" = "full" ]; then
  INFERENCE_IMAGE="${REPO}-inference:$([ "$DEVICE" = "cuda" ] && echo cuda || echo latest)"
  remove_container sirene-inference

  GPU_ARGS=""
  [ "$DEVICE" = "cuda" ] && GPU_ARGS="--gpus all"

  info "pulling $INFERENCE_IMAGE ..."
  $SUDO docker pull "$INFERENCE_IMAGE" >/dev/null

  info "starting sirene-inference ..."
  # shellcheck disable=SC2086
  $SUDO docker run -d \
    --name sirene-inference \
    --network "$NETWORK_NAME" \
    --restart unless-stopped \
    -e INFERENCE_ALLOW_NO_AUTH=true \
    -v "${DATA_DIR_ABS}/models:/app/data/models" \
    -v "${DATA_DIR_ABS}/packages:/app/data/packages" \
    $GPU_ARGS \
    "$INFERENCE_IMAGE" >/dev/null
  EFFECTIVE_INFERENCE_URL="http://sirene-inference:8000"
else
  EFFECTIVE_INFERENCE_URL="${INFERENCE_URL:-}"
fi

# Server.
SERVER_IMAGE="${REPO}:latest"
remove_container sirene-server

info "pulling $SERVER_IMAGE ..."
$SUDO docker pull "$SERVER_IMAGE" >/dev/null

info "starting sirene-server on port 80 ..."
SERVER_ENV_ARGS=()
if [ -n "$PB_PASSWORD" ]; then
  SERVER_ENV_ARGS+=(
    -e "PB_SUPERUSER_EMAIL=$PB_SUPERUSER_EMAIL"
    -e "PB_SUPERUSER_PASSWORD=$PB_PASSWORD"
  )
fi
if [ -n "$EFFECTIVE_INFERENCE_URL" ]; then
  SERVER_ENV_ARGS+=(-e "INFERENCE_URL=$EFFECTIVE_INFERENCE_URL")
fi

$SUDO docker run -d \
  --name sirene-server \
  --network "$NETWORK_NAME" \
  --restart unless-stopped \
  -p 80:80 \
  -v "${DATA_DIR_ABS}/pb_data:/app/db/pb_data" \
  "${SERVER_ENV_ARGS[@]}" \
  "$SERVER_IMAGE" >/dev/null

ok "Sirene is running"

printf "\n"
printf "  ${GREEN}┌${BORDER}┐${RESET}\n"
printf "  ${GREEN}│${RESET}  ${BOLD}%-43s${RESET}${GREEN}│${RESET}\n" "Sirene is ready!"
printf "  ${GREEN}│${RESET}  %-43s${GREEN}│${RESET}\n" ""
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "URL:" "http://localhost"
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Admin:" "http://localhost/db/_/"
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Email:" "${PB_SUPERUSER_EMAIL}"
if [ -n "$PB_PASSWORD" ]; then
  printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Password:" "${PB_PASSWORD}"
else
  printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Password:" "(see existing pb_data — credentials were not regenerated)"
fi
printf "  ${GREEN}│${RESET}  %-43s${GREEN}│${RESET}\n" ""
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Data:" "$DATA_DIR_ABS"
# Only point at the credentials file when we actually wrote one this run; on the
# "pb_data exists but no credentials file was found" path it would otherwise
# advertise a path that doesn't exist.
if [ -f credentials ]; then
  printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Creds:" "$(pwd)/credentials"
fi
printf "  ${GREEN}└${BORDER}┘${RESET}\n"
printf "\n"
