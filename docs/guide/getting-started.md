# Getting Started

## Docker (recommended)

The quickest way to run Sirene:

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | bash
```

See the [Docker guide](./docker.md) for more options.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.2.4
- [Python](https://www.python.org) >= 3.11
- [PocketBase](https://pocketbase.io) (installed automatically in the devcontainer)

For GPU support (optional): CUDA toolkit + `onnxruntime-gpu`.

## Installation

### With the devcontainer (recommended)

The project includes a `.devcontainer/devcontainer.json` pre-configured with Bun, Python and PocketBase. Open the project in VS Code or GitHub Codespaces and let the container build. All dependencies (JS and Python) are installed automatically via `postCreateCommand`.

### Manual installation

```bash
# 1. Clone the repo
git clone https://github.com/KevinBonnoron/sirene.git
cd sirene

# 2. Install JS dependencies
bun install

# 3. Install Python dependencies (inference)
pip install -e "./inference[cpu]"    # or [cuda] for CUDA support

# 4. Create the models directory
mkdir -p data/models
```

## Development

### Start all services

```bash
bun run dev
```

This starts all services concurrently:

| Service | Port | Command |
|---------|------|---------|
| PocketBase | 8090 | `pocketbase serve` |
| Hono Server | 3000 | `bun --watch run src/index.ts` |
| Vite Client | 5173 | `vite --host` |
| Inference FastAPI | 8000 | `uvicorn src.main:app --reload` |

### Start a single service

```bash
bun run -F @sirene/db dev          # PocketBase
bun run -F @sirene/server dev      # Hono
bun run -F @sirene/client dev      # Vite (React)
bun run -F @sirene/inference dev   # FastAPI (Python)

# Inference (in a separate terminal)
cd inference
python3 -m uvicorn src.main:app --reload --port 8000
```

## First Launch

1. Open PocketBase Admin: `http://localhost:8090/_/`
2. Create an admin account (email: `admin@sirene.local`, pick a password)
3. Collections (voices, voice_samples, generations) are created automatically via migrations in `db/pb_migrations/`
4. Open the app: `http://localhost:5173`
5. Go to the Models page and install Kokoro v1.0

## Available Scripts

```bash
bun run dev          # All services in dev mode
bun run build        # Production build (client + server)
bun run lint         # Biome lint
bun run format       # Biome format
bun run type-check   # TypeScript check
```
