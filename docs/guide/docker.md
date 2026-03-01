# Docker

The Docker image bundles all services (Nginx, Hono, FastAPI, PocketBase) via supervisord in a single container.

## Quick Install

The install script sets up everything automatically:

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | bash
```

It will:
1. Check for Docker and Docker Compose
2. Ask for CPU or CUDA variant
3. Generate PocketBase admin credentials
4. Create a `docker-compose.yml` and `.env` file
5. Pull and start the container

## Manual Setup

### Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  sirene:
    image: ghcr.io/kevinbonnoron/sirene:latest
    ports:
      - "80:80"
    volumes:
      - sirene-data:/app/db/pb_data
      - sirene-models:/app/data/models
    env_file:
      - .env
    restart: unless-stopped

volumes:
  sirene-data:
  sirene-models:
```

Create a `.env` file:

```env
PB_SUPERUSER_EMAIL=admin@sirene.local
PB_SUPERUSER_PASSWORD=your-secure-password
```

Then start:

```bash
docker compose up -d
```

### Docker Run

```bash
# CPU variant
docker run -p 80:80 \
  -v sirene-data:/app/db/pb_data \
  -v sirene-models:/app/data/models \
  -e PB_SUPERUSER_EMAIL=admin@sirene.local \
  -e PB_SUPERUSER_PASSWORD=changeme \
  ghcr.io/kevinbonnoron/sirene:latest

# CUDA variant (requires NVIDIA Container Toolkit)
docker run --gpus all -p 80:80 \
  -v sirene-data:/app/db/pb_data \
  -v sirene-models:/app/data/models \
  -e PB_SUPERUSER_EMAIL=admin@sirene.local \
  -e PB_SUPERUSER_PASSWORD=changeme \
  ghcr.io/kevinbonnoron/sirene:cuda
```

### Build from Source

```bash
# CPU variant
docker build -f docker/Dockerfile -t sirene .

# CUDA variant
docker build -f docker/Dockerfile -t sirene:cuda --build-arg INFERENCE_VARIANT=cuda .
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PB_SUPERUSER_EMAIL` | — | PocketBase admin email (created on first start) |
| `PB_SUPERUSER_PASSWORD` | — | PocketBase admin password |
| `VITE_PB_URL` | `/db` | PocketBase URL for the client |
| `VITE_SERVER_URL` | `/api` | API server URL for the client |
| `INFERENCE_DEVICE` | `cpu` | Inference device (`cpu` or `cuda`) |

## Volumes

| Volume | Container Path | Description |
|--------|----------------|-------------|
| `sirene-data` | `/app/db/pb_data` | PocketBase database and uploaded files |
| `sirene-models` | `/app/data/models` | Downloaded TTS models |

## Pre-built Images

Pre-built images are available from GitHub Container Registry:

```bash
# CPU
docker pull ghcr.io/kevinbonnoron/sirene:latest

# CUDA
docker pull ghcr.io/kevinbonnoron/sirene:cuda
```

## Architecture

The Docker image uses a multi-stage build:

1. **PocketBase** — Downloads the PocketBase binary for the target platform
2. **Bun** — Copies the Bun binary from the official image
3. **Inference** — Installs Python dependencies (PyTorch, ONNX Runtime)
4. **Final** — Combines all services with Nginx and supervisord

Nginx acts as a reverse proxy in production, routing:
- `/api` → Hono server
- `/db` → PocketBase
- `/` → React SPA (static files)

### CUDA & flash-attn

The CUDA build (`--build-arg INFERENCE_VARIANT=cuda`) installs the CUDA 12.4 toolkit (`nvcc`) in the build stage to compile `flash-attn` from source. The toolkit is NOT included in the final image — only the compiled Python packages are carried over.

For GPU deployment with Docker Compose, use the CUDA compose file:

```bash
docker compose -f docker/docker-compose.cuda.yml up -d
```
