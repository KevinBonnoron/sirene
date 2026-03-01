#!/bin/sh
set -e

# ── Sirene installer ────────────────────────────────────────────────────────
# Usage: curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | bash
# ─────────────────────────────────────────────────────────────────────────────

REPO="ghcr.io/kevinbonnoron/sirene"
INSTALL_DIR="sirene"

BORDER="─────────────────────────────────────────────"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
BOLD="\033[1m"
DIM="\033[2m"
RESET="\033[0m"

printf "\n"
printf "  ${CYAN}┌${BORDER}┐${RESET}\n"
printf "  ${CYAN}│${RESET}${BOLD}              Sirene Installer               ${CYAN}│${RESET}\n"
printf "  ${CYAN}│${RESET}${DIM}          Multi-backend TTS Router           ${CYAN}│${RESET}\n"
printf "  ${CYAN}└${BORDER}┘${RESET}\n"
printf "\n"

# ── Check prerequisites ─────────────────────────────────────────────────────

check_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: $1 is required but not installed."
    exit 1
  fi
}

check_command docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: docker compose is required but not available."
  echo "Install it: https://docs.docker.com/compose/install/"
  exit 1
fi

# ── Select deployment mode ───────────────────────────────────────────────────

printf "${BOLD}Select a deployment mode:${RESET}\n"
printf "  ${CYAN}1)${RESET} Local CPU          ${DIM}server + inference on this machine (default)${RESET}\n"
printf "  ${CYAN}2)${RESET} Local CUDA         ${DIM}server + inference on this machine (NVIDIA GPU)${RESET}\n"
printf "  ${CYAN}3)${RESET} Remote inference   ${DIM}server here, inference on RunPod/external GPU${RESET}\n"
printf "${YELLOW}Choice [1]:${RESET} "
read -r MODE_CHOICE </dev/tty

IMAGE="${REPO}:latest"
INFERENCE_URL=""
INFERENCE_IMAGE=""

case "$MODE_CHOICE" in
  2)
    INFERENCE_IMAGE="${REPO}-inference:cuda"
    ;;
  3)
    printf "${YELLOW}Inference URL (e.g. https://abc123-8000.proxy.runpod.net):${RESET} "
    read -r INFERENCE_URL </dev/tty
    if [ -z "$INFERENCE_URL" ]; then
      echo "Error: inference URL is required for remote mode."
      exit 1
    fi
    ;;
  *)
    INFERENCE_IMAGE="${REPO}-inference:latest"
    ;;
esac

# ── Create install directory ─────────────────────────────────────────────────

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

# ── Generate credentials ────────────────────────────────────────────────────

PB_SUPERUSER_EMAIL="admin@sirene.local"
PB_PASSWORD=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)

cat > .env <<EOF
# PocketBase admin credentials (auto-generated)
PB_SUPERUSER_EMAIL=${PB_SUPERUSER_EMAIL}
PB_SUPERUSER_PASSWORD=${PB_PASSWORD}
EOF

echo "Generated PocketBase credentials in .env"

# ── Write docker-compose.yml ────────────────────────────────────────────────

if [ "$MODE_CHOICE" = "3" ]; then
  # Remote inference — server only, INFERENCE_URL points to external service
  cat > docker-compose.yml <<EOF
services:
  server:
    image: ${IMAGE}
    ports:
      - "80:80"
    volumes:
      - sirene-data:/app/db/pb_data
    environment:
      - INFERENCE_URL=${INFERENCE_URL}
    env_file:
      - .env
    restart: unless-stopped

volumes:
  sirene-data:
EOF

else
  # Local inference — both services on this machine
  CUDA_SECTION=""
  if [ "$MODE_CHOICE" = "2" ]; then
    CUDA_SECTION="
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]"
  fi

  cat > docker-compose.yml <<EOF
services:
  server:
    image: ${IMAGE}
    ports:
      - "80:80"
    volumes:
      - sirene-data:/app/db/pb_data
    env_file:
      - .env
    restart: unless-stopped

  inference:
    image: ${INFERENCE_IMAGE}
    volumes:
      - sirene-models:/app/data/models
      - sirene-packages:/app/data/packages
    restart: unless-stopped${CUDA_SECTION}

volumes:
  sirene-data:
  sirene-models:
  sirene-packages:
EOF

fi

echo "Created docker-compose.yml"

# ── Pull and start ──────────────────────────────────────────────────────────

echo ""
printf "Start Sirene now? [Y/n]: "
read -r START_NOW </dev/tty

case "$START_NOW" in
  [nN]*) echo "To start later: cd $INSTALL_DIR && docker compose up -d" ;;
  *)
    echo "Pulling image..."
    docker compose pull
    echo "Starting Sirene..."
    docker compose up -d
    echo ""
    echo "Sirene is running!"
    ;;
esac

# ── Summary ─────────────────────────────────────────────────────────────────

printf "\n"
printf "  ${GREEN}┌${BORDER}┐${RESET}\n"
printf "  ${GREEN}│${RESET}  ${BOLD}%-43s${RESET}${GREEN}│${RESET}\n" "Sirene is ready!"
printf "  ${GREEN}│${RESET}  %-43s${GREEN}│${RESET}\n" ""
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "URL:" "http://localhost"
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Admin:" "http://localhost/db/_/"
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Email:" "${PB_SUPERUSER_EMAIL}"
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Password:" "${PB_SUPERUSER_PASSWORD}"
printf "  ${GREEN}│${RESET}  %-43s${GREEN}│${RESET}\n" ""
printf "  ${GREEN}│${RESET}  ${YELLOW}%-10s${RESET}%-33s${GREEN}│${RESET}\n" "Config:" "./$INSTALL_DIR/.env"
printf "  ${GREEN}└${BORDER}┘${RESET}\n"
printf "\n"
