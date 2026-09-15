# Docker

Sirene is split into two Docker images:

- **`ghcr.io/kevinbonnoron/sirene`** - a single Go binary: API + PocketBase + React client
- **`ghcr.io/kevinbonnoron/sirene-inference`** - Python inference server (FastAPI + uvicorn)

All model management (download, install check, deletion) is handled by the inference server. The server container only needs persistent storage for the PocketBase database.

## Quick Install

The install script sets up everything automatically:

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | bash
```

It will:
1. Check for Docker and Docker Compose
2. Ask for your deployment mode (see below)
3. Pull and start the containers

The first account created in the web UI becomes the administrator. To open the PocketBase dashboard at `/_/`, create a superuser by running the installer again in `recover` mode from the directory where you installed (the one containing `sirene/`):

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | INSTALL_MODE=recover bash
```

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

### Standalone inference (script install)

Once Sirene is running, you can add **additional inference servers** to the fleet. Open **Administration → Inference servers → Add server**: the dialog prints an install command that embeds a registration token (valid one hour, only allows registering). On a fresh Linux machine (root or sudo required), run it:

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | INSTALL_MODE=inference SIRENE_URL=https://sirene.example.com SIRENE_REGISTRATION_TOKEN=sr_... bash
```

The script:
1. Detects your distro (Ubuntu / Debian) and NVIDIA GPU
2. Installs Docker and the NVIDIA Container Toolkit if missing
3. Pulls the inference image and starts it with a randomly generated auth token
4. Waits for the worker to register itself with Sirene and reports the result

The worker calls `POST /api/inference-servers/register` once at startup with its public URL (`SERVER_URL`, detected from the machine's first address when unset) and its auth token. Sirene upserts the entry by URL, so rerunning the installer or restarting the container never creates duplicates. The call is best effort: if Sirene is unreachable the worker keeps running and the script prints the URL and token to add by hand.

Without `SIRENE_URL` the script behaves as before and prints the URL and auth token to paste into the manual form.

The auth token stays on the inference server (as `INFERENCE_AUTH_TOKEN`) and is sent by Sirene on every request as `Authorization: Bearer ...` - the inference server rejects anything else.

### Remote inference (Railway, RunPod or any Docker host)

The **Add server** dialog generates the exact command or configuration for each target: Linux script, `docker run`, Docker Compose, Railway or RunPod, on CPU or NVIDIA GPU.

On Railway, use the published template: the **Add server** dialog has a **Deploy on Railway** button that opens [railway.com/deploy/sirene-inference](https://railway.com/deploy/sirene-inference). Railway asks for two values, `SIRENE_URL` and `SIRENE_REGISTRATION_TOKEN`, both shown in the dialog; the image, the volume on `/app/data`, the public HTTP port and a generated `INFERENCE_AUTH_TOKEN` are part of the template.

On any other Docker host, deploy `ghcr.io/kevinbonnoron/sirene-inference:latest` (or `:cuda` on a GPU host) with the environment variables shown in the **Add server** dialog:

| Variable | Value |
|----------|-------|
| `SIRENE_URL` | Public URL of your Sirene server |
| `SIRENE_REGISTRATION_TOKEN` | Token from the dialog (one hour) |
| `INFERENCE_AUTH_TOKEN` | A long random secret; the dialog generates one |
| `INFERENCE_PUBLIC_URL` | Public URL of the worker. Optional on Railway and RunPod, derived from `RAILWAY_PUBLIC_DOMAIN` or `RUNPOD_POD_ID` |
| `INFERENCE_NAME` | Name shown in Sirene. Optional, defaults to `RAILWAY_SERVICE_NAME` or the hostname |

The image listens on `PORT` when the host injects one (Railway does) and on 8000 otherwise. Attach a persistent volume at `/app/data` so models and lazily installed backends survive redeploys.

The same `install.sh` covers all three modes: `INSTALL_MODE=full` (default - server + inference), `INSTALL_MODE=server` (just the app), `INSTALL_MODE=inference` (just an inference server).

### Remote Inference (RunPod)

Run the server locally (or on a cheap VPS) and offload inference to a [RunPod](https://www.runpod.io/) GPU pod. This avoids needing a local GPU - model files and Python dependencies live entirely on the pod.

> **Why a Pod and not Serverless?** Sirene's inference service is a long-running HTTP server (FastAPI). RunPod Serverless requires a custom handler format and would cold-start on every request, which is too slow for loading TTS models into GPU memory. A GPU Pod keeps the service running and ready.

#### 1. Create a GPU Pod on RunPod

1. Go to [runpod.io/console/pods](https://www.runpod.io/console/pods) and click **+ GPU Pod**
2. Pick a GPU (RTX 3090, RTX 4090, A40, etc. - 16 GB+ VRAM recommended)
3. Under **Container Image**, enter: `ghcr.io/kevinbonnoron/sirene-inference:cuda`
4. Under **Expose HTTP Ports**, add: `8000`
5. Under **Environment Variables**, add:
   - `INFERENCE_DEVICE` = `cuda`
6. (Recommended) Attach a **Network Volume** mounted at `/app/data` to persist downloaded models and packages across pod restarts
7. Click **Deploy**

Once the pod is running, RunPod gives you a proxy URL. Find it in the pod's **Connect** tab - it looks like:

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
    restart: unless-stopped

volumes:
  sirene-data:
```

Replace `{pod-id}` with your actual pod ID from RunPod.

#### Tips

- **Cost** - stop the pod from the RunPod dashboard when you're not using it. Models stored on a Network Volume will still be there when you restart.
- **Spot pods** - cheaper but can be interrupted. Fine for non-critical usage.
- **Latency** - audio generation involves large responses. Pick a RunPod region close to your server for best performance.

## Environment Variables

### Server (`sirene`)

| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_URL` | `http://inference:8000` (image), `http://localhost:8000` (binary) | URL of the inference service seeded as the `Local` server. `INSTALL_MODE=full` points it at the bundled inference container; `INSTALL_MODE=server` starts none, so set it to a reachable service or add one from **Settings → Inference servers** before installing models. |

### Inference (`sirene-inference`)

| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_DEVICE` | `cpu` | `cpu` or `cuda` |
| `INFERENCE_MODELS_PATH` | `/app/data/models` | Path to model files |
| `INFERENCE_AUTH_TOKEN` | - | When set, every request (except `/health`) must carry `Authorization: Bearer <token>`. Set automatically by `INSTALL_MODE=inference`; leave unset for trusted-network setups. |
| `PACKAGES_DIR` | `/app/data/packages` | Persistent dir for lazily installed backend deps |

## Volumes

| Volume | Service | Container Path | Description |
|--------|---------|----------------|-------------|
| `sirene-data` | server | `/app/db/pb_data` | PocketBase database and uploaded files |
| `sirene-models` | inference | `/app/data/models` | Downloaded TTS models |
| `sirene-packages` | inference | `/app/data/packages` | Lazily installed Python backend packages |

## Upgrading

Migrations run automatically on start and cannot be rolled back: back up the PocketBase data before upgrading. With Compose that is the `sirene-data` volume; with `install.sh` it is the host directory `sirene/data/pb_data` (or `$DATA_DIR/pb_data`) mounted into the container.

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

The server container runs one process, `sirene serve`, which answers on port 80:
- `/api/*` → Sirene routes and the PocketBase API (records, files, realtime)
- `/_/` → PocketBase dashboard
- `/` → React SPA (embedded in the binary)

The server delegates all model operations (download, install check, deletion) to the inference container via its REST API at `INFERENCE_URL`. Backend Python dependencies (torch, onnxruntime, etc.) are **not** bundled in the image - they are installed on demand into the `sirene-packages` volume the first time a model using that backend is installed.
