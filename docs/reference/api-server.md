# API Server (Hono)

The Hono server runs on port **3000** and acts as the orchestrator. It handles validation, resolves voices/parameters, and forwards inference requests to the FastAPI service.

## Generation

### Generate Speech

```http
POST /api/generate
```

**Body:**

```json
{
  "model": "kokoro-v1",
  "input": "Hello, world!",
  "voice": "voice_id",
  "speed": 1.0,
  "language": "en",
  "stream": false
}
```

**Response:** `audio/wav` or `audio/pcm` (when `stream: true`)

## Voices

### List Voices

```http
GET /api/voices
```

### Create a Voice

```http
POST /api/voices
```

**Body:** `multipart/form-data` with name, description, language, avatar.

### Get Voice Details

```http
GET /api/voices/:id
```

### Update a Voice

```http
PUT /api/voices/:id
```

### Delete a Voice

```http
DELETE /api/voices/:id
```

### Add a Sample

```http
POST /api/voices/:id/samples
```

**Body:** `multipart/form-data` with audio file and transcript.

### Delete a Sample

```http
DELETE /api/voices/:id/samples/:sid
```

## Models

### Get Model Catalog

```http
GET /api/models/catalog
```

Returns the list of available models from embedded manifests.

### Get Installed Models

```http
GET /api/models/installed
```

Scans the filesystem to list installed models.

### Pull a Model

```http
GET /api/models/:id/pull
```

**Response:** Server-Sent Events stream with download progress:

```
data: {"progress": 45, "speed": "12.5 MB/s", "status": "downloading"}
data: {"progress": 100, "status": "complete"}
```

### Delete a Model

```http
DELETE /api/models/:id
```

### Model Events

```http
GET /api/models/events
```

SSE stream notifying filesystem changes (model installed/removed).

## Transcription

### Transcribe Audio

```http
POST /api/transcribe
```

**Body:** `multipart/form-data` with `audio` file.

**Response:**

```json
{
  "text": "transcribed text",
  "language": "en"
}
```

## History

### List Generations

```http
GET /api/generations
```

Paginated list with filters: voice, model, language, date.

### Get Generation Details

```http
GET /api/generations/:id
```

### Delete a Generation

```http
DELETE /api/generations/:id
```

## System

### Health Check

```http
GET /api/health
```

### Version

```http
GET /api/version
```
