# Introduction

Sirene is a multi-backend text-to-speech router with a web interface. It provides a single entry point to generate speech via multiple TTS backends with custom voice management via audio samples.

## Tech Stack

| Layer | Technology |
|-------|------------|
| JS Runtime | Bun |
| Task runner | Task (Taskfile) |
| Server | Go (PocketBase as a framework) |
| Inference | FastAPI + ONNX Runtime / PyTorch |
| DB / Realtime / Files | PocketBase |
| Desktop | Wails v3 (Go) |
| Frontend | React 19 + Vite + TanStack Router |
| UI | Tailwind CSS + Radix UI |
| State | TanStack Query + PocketBase SSE |
| Linting | Biome |

## Architecture

```
Client (React)
  |
sirene (Go binary, one port)
  |-- /api/*            --> Sirene routes + PocketBase API (records, files, realtime)
  |-- /_/               --> PocketBase dashboard
  '-- /                --> React SPA (embedded)
        |
        '-- Inference FastAPI (port 8000, one or many)
```

### Responsibilities

**Client (React)** - User interface. Connects to PocketBase via SSE for real-time updates (download progress, generation status). Communicates with the Sirene server for actions.

**Server (Go)** - Pure orchestrator, zero inference. Embeds PocketBase as a library: it validates requests, resolves voices and parameters, forwards inference to the Python service and writes results straight into the database.

**Inference (FastAPI)** - All TTS inference. A single PyTorch runtime, one GPU, lazy-loading models, memory cache. Downloads models on demand into a Docker volume.

**PocketBase** - SQLite database, file storage (audio samples, generations), real-time SSE subscriptions and a dashboard at `/_/`, all inside the server binary.

## Monorepo Structure

```
sirene/
├── client/          # React + Vite + Tailwind
├── server/          # Go server on PocketBase (orchestrator, zero inference)
├── desktop/         # Wails desktop app (embeds the server, bootstraps Python at first run)
├── inference/       # FastAPI + TTS backends (Kokoro, Qwen, F5, Piper)
├── shared/          # Shared TypeScript types
├── db/pb_data/      # Development database (gitignored)
├── docs/            # VitePress documentation
├── docker/          # Dockerfiles and compose files
└── data/models/     # Downloaded models (gitignored)
```

## Supported Backends

| Backend | Voice Cloning | Streaming | Languages |
|---------|:---:|:---:|---|
| Kokoro | - | - | EN, FR, JA, KO, ZH |
| Qwen3-TTS | Yes | - | 10+ languages |
| F5-TTS | Yes | Yes | Multilingual |
| Piper | - | - | 26 languages, 40+ voices |
| CosyVoice | Yes | Yes (~150ms) | 9 languages |
| OpenAudio S1 | Yes | - | Multilingual |
| Chatterbox | Yes | - | EN + 23 languages |
