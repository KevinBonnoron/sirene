# Models

## Overview

- The Docker image ships with **zero models** - only code and manifests
- A Docker volume (`sirene-models`) persists models between restarts
- Models are downloaded on demand from the web interface
- The Python service downloads into the volume and lazy-loads into GPU memory

## Catalog

The catalog is a single JSON file embedded in the server, `server/internal/catalog/models.json`, served as-is by `GET /api/models/catalog`. One entry per installable model:

| Field | Meaning |
|-------|---------|
| `id`, `name`, `description` | Identity shown in the UI |
| `backend`, `backendDisplayName`, `backendDescription` | Inference backend that runs the model; the UI groups entries by backend |
| `repo`, `files`, `size` | Hugging Face repository, files to download (a file may point at another repo), total size in bytes |
| `types` | `preset`, `cloning`, `design`, `transcription`, `api` |
| `presetVoices` | Built-in voices for preset models |
| `maxReferenceDuration`, `supportsInstruct`, `supportsEffects` | Cloning limits and prompt features |
| `gated` | The repository needs a Hugging Face token |
| `license`, `commercial` | License of the weights and whether commercial use is allowed (`commercial` absent means unknown) |
| `hardware`, `minVram` | `cpu` runs comfortably on CPU, `gpu` means a GPU is recommended; `minVram` in GB only when the upstream documents it |
| `languages` | ISO 639-1 codes, `"*"` for 100+ languages |
| `recommended` | Shown first in its group |
| `legacy` | Never offered by the add-model assistant (superseded or unmaintained upstream) |

The Models page lists installed models only, one row per family with its variants underneath and a facts line built from these fields (hardware, license, languages, size). The **Add a model** assistant asks what you want to do, then ranks the catalog entries for that purpose by `recommended` and by whether an online worker can run them: the worker's `/health` returns its effective device, which the health loop stores on the server entry.

Piper voices are one catalog entry each; the assistant offers them as a filterable list and the installed ones sit under a single Piper family.

## Download Flow

```
1. User clicks [Install] on a model in the web UI
2. Client calls POST /api/models/:id/pull and receives job ids
3. Sirene server:
   a. Creates one in-memory job per target inference server
   b. Asks each server to POST /models/pull with the HuggingFace file URLs
   c. Relays the worker's SSE progress into the job store
4. Inference server downloads the files into its models directory and
   installs the backend dependencies on demand
5. Client follows GET /api/jobs/stream (SSE) for progress, and GET
   /api/models/events (SSE) pings it to refresh the installed list
```

## Storage Layout

```
/data/models/
├── kokoro/
│   └── v1.0/
│       ├── model.onnx
│       └── config.json
├── qwen3-tts/
│   └── 1.7B/
│       ├── model.safetensors
│       ├── config.json
│       └── tokenizer.json
├── f5tts/
│   └── default/
│       ├── model.safetensors
│       └── vocab.txt
└── piper/
    └── fr_FR-siwis-medium/
        ├── model.onnx
        └── model.onnx.json
```

## Memory Management

The inference service manages GPU memory with:

- **Lazy loading** - Models are loaded only when first used
- **LRU eviction** - When `INFERENCE_MAX_LOADED_MODELS` is reached, the least recently used model is unloaded
- **Manual unload** - Models can be explicitly unloaded via `POST /models/unload`
