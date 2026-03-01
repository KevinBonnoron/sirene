# Introduction

Sirene is a multi-backend text-to-speech router with a web interface. It provides a single entry point to generate speech via multiple TTS backends with custom voice management via audio samples.

## Tech Stack

| Layer | Technology |
|-------|------------|
| JS Runtime | Bun |
| Monorepo | Turborepo |
| Server | Hono |
| Inference | FastAPI + ONNX Runtime / PyTorch |
| DB / Realtime / Files | PocketBase |
| Frontend | React 19 + Vite + TanStack Router |
| UI | Tailwind CSS + Radix UI |
| State | TanStack Query + PocketBase SSE |
| Linting | Biome |

## Architecture

```
Client (React)
  |
Nginx (reverse proxy in production)
  |-- /api  --> Hono Server (Bun, port 3000)
  |               |-- PocketBase (port 8090)
  |               '-- Inference FastAPI (port 8000)
  |-- /db   --> PocketBase
  '-- /     --> React SPA
```

### Responsibilities

**Client (React)** — User interface. Connects to PocketBase via SSE for real-time updates (download progress, generation status). Communicates with the Hono server for actions.

**Server (Hono)** — Pure orchestrator, zero inference. Receives requests, validates, resolves voices/parameters, forwards to the Python service for inference, and writes results to PocketBase.

**Inference (FastAPI)** — All TTS inference. A single PyTorch runtime, one GPU, lazy-loading models, memory cache. Downloads models on demand into a Docker volume.

**PocketBase** — SQLite database, file storage (audio samples, generations), real-time SSE subscriptions, admin UI for debugging.

## Monorepo Structure

```
sirene/
├── client/          # React + Vite + Tailwind
├── server/          # Hono (orchestrator, zero inference)
├── inference/       # FastAPI + TTS backends (Kokoro, Qwen, F5, Piper)
├── shared/          # Shared TypeScript types
├── db/              # PocketBase (migrations, data)
├── docs/            # VitePress documentation
├── docker/          # Dockerfile, nginx, supervisord, entrypoint
└── data/models/     # Downloaded models (gitignored)
```

## Supported Backends

| Backend | Voice Cloning | Streaming | Languages |
|---------|:---:|:---:|---|
| Kokoro | — | — | EN, FR, JA, KO, ZH |
| Qwen3-TTS | Yes | — | 10+ languages |
| F5-TTS | Yes | Yes | Multilingual |
| Piper | — | — | 26 languages, 40+ voices |
| CosyVoice | Yes | Yes (~150ms) | 9 languages |
| OpenAudio S1 | Yes | — | Multilingual |
| Chatterbox | Yes | — | EN + 23 languages |
