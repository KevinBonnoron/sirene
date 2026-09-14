# Configuration

All configuration is done via environment variables. Default values work for local development.

## Server (`sirene`)

The server is a single Go binary built on PocketBase: it serves the API, the database, file storage, realtime and the web UI on one port.

| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_URL` | `http://localhost:8000` | Inference service seeded as the `Local` inference server on first start |
| `SIRENE_UI_DIR` | - | Serve the web UI from this directory instead of the embedded build |

Command-line flags come from PocketBase:

```bash
sirene serve --http=0.0.0.0:80 --dir=/app/db/pb_data   # start the server
sirene superuser upsert EMAIL PASSWORD --dir=...        # dashboard superuser for /_/
sirene migrate up --dir=...                             # apply pending migrations
```

The first account created in the web UI becomes the Sirene administrator. The PocketBase dashboard superuser is a separate, optional account used only for `/_/`.

## Inference (FastAPI)

| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_MODELS_PATH` | `/data/models` | Models directory |
| `INFERENCE_DEVICE` | `cuda` | Device (`cuda` or `cpu`) |
| `INFERENCE_MAX_LOADED_MODELS` | `2` | Max models loaded in memory simultaneously |
| `INFERENCE_AUTH_TOKEN` | - | Bearer token required on every request except `/health` |
| `INFERENCE_ALLOW_NO_AUTH` | `false` | Allow running without a token (trusted networks only) |
| `PACKAGES_DIR` | - | Persistent directory for lazily installed backend packages |

## Client (Vite)

The client has no build-time configuration: it talks to the API, PocketBase and files on its own origin. In development, Vite proxies `/api` and `/_` to the Go server on port 8090.

## Desktop app

The desktop app embeds the server and bootstraps the inference worker under `~/.sirene`.

| Variable | Default | Description |
|----------|---------|-------------|
| `SIRENE_HOME` | `~/.sirene` | Data directory (database, models, Python runtime, logs) |
| `SIRENE_INFERENCE_DEVICE` | `cpu` | Device passed to the bundled inference worker |
| `SIRENE_UI_DIR` | - | Serve the web UI from this directory (development) |
