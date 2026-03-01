# Docker

Sirene is split into two Docker images:

- **`ghcr.io/kevinbonnoron/sirene`** — Nginx + React client + Hono API + PocketBase
- **`ghcr.io/kevinbonnoron/sirene-inference`** — Python inference server (FastAPI + uvicorn)

All model management (download, install check, deletion) is handled by the inference server. The server container only needs persistent storage for the PocketBase database.

## Quick Install

The install script sets up everything automatically:

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | bash
```

It will:
1. Check for Docker and Docker Compose
2. Ask for your deployment mode (see below)
3. Generate PocketBase admin credentials
4. Create a `docker-compose.yml` and `.env` file
5. Pull and start the containers

## Deployment Modes

### Local CPU

Everything runs on the same machine. Backend dependencies (torch, onnxruntime, etc.) are downloaded on demand when you install a model.

```yaml
services:
  server:
    image: ghcr.io/kevinbonnoron/sirene:latest
    ports:
      - "80:80"
    volumes:
      - sirene-data:/app/db/pb_data
    env_file:
      - .env
    restart: unless-stopped

  inference:
    image: ghcr.io/kevinbonnoron/sirene-inference:latest
    volumes:
      - sirene-models:/app/data/models
      - sirene-packages:/app/data/packages
    restart: unless-stopped

volumes:
  sirene-data:
  sirene-models:
  sirene-packages:
```

### Local CUDA (NVIDIA GPU)

Same as above but the inference service uses the CUDA image and requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

```yaml
  inference:
    image: ghcr.io/kevinbonnoron/sirene-inference:cuda
    volumes:
      - sirene-models:/app/data/models
      - sirene-packages:/app/data/packages
    restart: unless-stopped
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

### Remote Inference (RunPod)

Run the server locally (or on a cheap VPS) and offload inference to a [RunPod](https://www.runpod.io/) GPU pod. This avoids needing a local GPU — model files and Python dependencies live entirely on the pod.

> **Why a Pod and not Serverless?** Sirene's inference service is a long-running HTTP server (FastAPI). RunPod Serverless requires a custom handler format and would cold-start on every request, which is too slow for loading TTS models into GPU memory. A GPU Pod keeps the service running and ready.

#### 1. Create a GPU Pod on RunPod

1. Go to [runpod.io/console/pods](https://www.runpod.io/console/pods) and click **+ GPU Pod**
2. Pick a GPU (RTX 3090, RTX 4090, A40, etc. — 16 GB+ VRAM recommended)
3. Under **Container Image**, enter: `ghcr.io/kevinbonnoron/sirene-inference:cuda`
4. Under **Expose HTTP Ports**, add: `8000`
5. Under **Environment Variables**, add:
   - `INFERENCE_DEVICE` = `cuda`
6. (Recommended) Attach a **Network Volume** mounted at `/app/data` to persist downloaded models and packages across pod restarts
7. Click **Deploy**

Once the pod is running, RunPod gives you a proxy URL. Find it in the pod's **Connect** tab — it looks like:

```
https://{pod-id}-8000.proxy.runpod.net
```

You can verify the inference service is ready:

```bash
curl https://{pod-id}-8000.proxy.runpod.net/health
```

#### 2. Deploy the server locally

On your machine or VPS, run only the `server` container and point `INFERENCE_URL` to your RunPod pod:

```yaml
services:
  server:
    image: ghcr.io/kevinbonnoron/sirene:latest
    ports:
      - "80:80"
    volumes:
      - sirene-data:/app/db/pb_data
    environment:
      - INFERENCE_URL=https://{pod-id}-8000.proxy.runpod.net
    env_file:
      - .env
    restart: unless-stopped

volumes:
  sirene-data:
```

Replace `{pod-id}` with your actual pod ID from RunPod.

#### Tips

- **Cost** — stop the pod from the RunPod dashboard when you're not using it. Models stored on a Network Volume will still be there when you restart.
- **Spot pods** — cheaper but can be interrupted. Fine for non-critical usage.
- **Latency** — audio generation involves large responses. Pick a RunPod region close to your server for best performance.

## Environment Variables

### Server (`sirene`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PB_SUPERUSER_EMAIL` | — | PocketBase admin email (created on first start) |
| `PB_SUPERUSER_PASSWORD` | — | PocketBase admin password |
| `VITE_PB_URL` | `/db` | PocketBase URL as seen by the browser |
| `VITE_SERVER_URL` | `/api` | API server URL as seen by the browser |
| `INFERENCE_URL` | `http://inference:8000` | URL of the inference service |

### Inference (`sirene-inference`)

| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_DEVICE` | `cpu` | `cpu` or `cuda` |
| `INFERENCE_MODELS_PATH` | `/app/data/models` | Path to model files |
| `SIRENE_PACKAGES_DIR` | `/app/data/packages` | Persistent dir for lazily installed backend deps |

## Volumes

| Volume | Service | Container Path | Description |
|--------|---------|----------------|-------------|
| `sirene-data` | server | `/app/db/pb_data` | PocketBase database and uploaded files |
| `sirene-models` | inference | `/app/data/models` | Downloaded TTS models |
| `sirene-packages` | inference | `/app/data/packages` | Lazily installed Python backend packages |

## Build from Source

```bash
# Server image
docker build -f docker/Dockerfile -t sirene .

# Inference image (CPU)
docker build -f docker/Dockerfile.inference -t sirene-inference .

# Inference image (CUDA)
docker build -f docker/Dockerfile.inference -t sirene-inference:cuda --build-arg INFERENCE_VARIANT=cuda .
```

## Architecture

Nginx routes all traffic in the server container:
- `/api` → Hono server (port 3000)
- `/db` → PocketBase (port 8090)
- `/` → React SPA (static files)

The Hono server delegates all model operations (download, install check, deletion) to the inference container via its REST API at `INFERENCE_URL`. Backend Python dependencies (torch, onnxruntime, etc.) are **not** bundled in the image — they are installed on demand into the `sirene-packages` volume the first time a model using that backend is installed.
