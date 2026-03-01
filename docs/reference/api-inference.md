# API Inference (FastAPI)

The inference service runs on port **8000** and handles all TTS model loading and processing. It is an internal API called only by the Hono server.

## Generate Audio

```http
POST /generate
```

**Body:**

```json
{
  "backend": "kokoro",
  "text": "Hello, world!",
  "voice_path": "/data/models/kokoro/v1.0/voices/af_heart.pt",
  "speed": 1.0,
  "language": "en",
  "reference_audio": null,
  "reference_text": null,
  "model_path": "/data/models/kokoro/v1.0"
}
```

**Response:** `audio/wav`

## Generate Audio (Streaming)

```http
POST /generate/stream
```

Same body as above.

**Response:** `audio/pcm` chunked transfer encoding.

## Backends

### List Available Backends

```http
GET /backends
```

Returns the list of registered TTS backends.

### Get Backend Status

```http
GET /backends/:name/status
```

Returns the backend's status including whether a model is loaded and memory usage.

## Models

### Pull a Model

```http
POST /models/pull
```

**Body:**

```json
{
  "url": "https://huggingface.co/...",
  "dest_path": "/data/models/kokoro/v1.0",
  "manifest": { }
}
```

**Response:** Server-Sent Events stream:

```
data: {"progress": 45, "speed": "12.5 MB/s", "status": "downloading"}
data: {"progress": 100, "status": "complete"}
```

### Unload a Model

```http
POST /models/unload
```

**Body:**

```json
{
  "backend": "kokoro",
  "model_path": "/data/models/kokoro/v1.0"
}
```

Frees GPU memory by unloading the specified model.

## Transcription

### Transcribe Audio

```http
POST /transcribe
```

**Body:** `multipart/form-data` with `audio` file.

**Response:**

```json
{
  "text": "transcribed text",
  "language": "en"
}
```

Uses Whisper for automatic speech recognition.
