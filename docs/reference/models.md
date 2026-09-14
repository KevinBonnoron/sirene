# Models

## Overview

- The Docker image ships with **zero models** - only code and manifests
- A Docker volume (`sirene-models`) persists models between restarts
- Models are downloaded on demand from the web interface
- The Python service downloads into the volume and lazy-loads into GPU memory

## Manifest System

Each model has a JSON manifest embedded in the `manifests/` directory that describes its files, download URLs, and variants.

**Example manifest:**

```json
{
  "name": "qwen3-tts",
  "description": "Qwen3-TTS by Alibaba",
  "backend": "qwen",
  "license": "Apache-2.0",
  "variants": {
    "1.7B": {
      "files": ["model.safetensors", "config.json", "tokenizer.json"],
      "url": "https://huggingface.co/Qwen/Qwen3-TTS/resolve/main/",
      "size": 3400000000
    },
    "0.6B": {
      "files": ["model.safetensors", "config.json", "tokenizer.json"],
      "url": "https://huggingface.co/Qwen/Qwen3-TTS-0.6B/resolve/main/",
      "size": 1200000000
    }
  },
  "defaults": {
    "variant": "1.7B",
    "sample_rate": 24000
  }
}
```

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
