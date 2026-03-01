# Configuration

All configuration is done via environment variables. Default values work for local development.

## Server (Hono)

| Variable | Default | Description |
|----------|---------|-------------|
| `POCKETBASE_URL` | `http://localhost:8090` | PocketBase URL |
| `PB_SUPERUSER_EMAIL` | `admin@sirene.local` | PocketBase admin email |
| `PB_SUPERUSER_PASSWORD` | `changeme123` | PocketBase admin password |
| `MODELS_PATH` | `./data/models` | Models directory |
| `INFERENCE_URL` | `http://localhost:8000` | Inference service URL |

## Inference (FastAPI)

| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_MODELS_PATH` | `/data/models` | Models directory |
| `INFERENCE_DEVICE` | `cuda` | Device (`cuda` or `cpu`) |
| `INFERENCE_MAX_LOADED_MODELS` | `2` | Max models loaded in memory simultaneously |

## Client (Vite)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_PB_URL` | — | PocketBase URL (set at build time) |
| `VITE_SERVER_URL` | — | Hono server URL (set at build time) |

::: tip
In development, Vite proxies requests to the backend services automatically. These variables are only needed for production builds.
:::

## Docker

These variables are used by the Docker entrypoint to initialize PocketBase on first start:

| Variable | Default | Description |
|----------|---------|-------------|
| `PB_SUPERUSER_EMAIL` | — | PocketBase admin email (auto-created on startup) |
| `PB_SUPERUSER_PASSWORD` | — | PocketBase admin password |
| `INFERENCE_DEVICE` | `cpu` | Inference device (`cpu` or `cuda`) |

::: tip
The `install.sh` script generates these automatically. See the [Docker guide](./docker.md) for details.
:::
