# Database

Sirene uses [PocketBase](https://pocketbase.io) as its database, file storage, and real-time engine. PocketBase runs on port **8090** and provides an admin UI at `http://localhost:8090/_/`.

## Collections

Collections are created automatically via migrations in `db/pb_migrations/`.

### `voices`

| Field | Type | Description |
|-------|------|-------------|
| `name` | text | Voice name |
| `description` | text | Description |
| `language` | text | Language code (en, fr, es...) |
| `avatar` | file | Voice avatar image |
| `builtIn` | bool | Built-in model voice vs custom |
| `samples` | relation[] | Link to `voice_samples` (multi-select, cascade delete) |

### `voice_samples`

| Field | Type | Description |
|-------|------|-------------|
| `audio` | file | Audio file (WAV/MP3) |
| `transcript` | text | Sample transcription (manual or auto via Whisper) |
| `duration` | number | Duration in seconds |

### `generations`

| Field | Type | Description |
|-------|------|-------------|
| `voice` | relation | Link to `voices` |
| `model` | text | Model ID (e.g., `kokoro-v1`) |
| `text` | text | Source text |
| `language` | text | Generation language |
| `audio` | file | Generated audio file |
| `duration` | number | Duration in seconds |
| `speed` | number | Generation speed |

## Voice Creation Workflow

```
1. User clicks "Create Voice"
   → Dialog: name, description, language, avatar

2. Upload 1-N audio samples (WAV/MP3, 5-30s each)
   → Waveform preview (wavesurfer.js), play/pause, duration
   → Transcription: text field + auto-transcribe button (Whisper)
   → Upload to voice_samples collection

3. Hono server:
   a. Creates the voice in PocketBase (voices collection)
   b. Stores samples in PocketBase (voice_samples, file field)
   c. Forwards samples to the Python service for preprocessing

4. Python service:
   a. Decodes and normalizes samples (resample, mono, RMS)
   b. Prepares optimized reference audio for each compatible backend
   c. Stores processed files in the volume

5. The voice is available for generation
   → Client sees the voice appear in real-time via PocketBase SSE
```

## Real-time Updates

PocketBase provides real-time subscriptions via Server-Sent Events. The client subscribes to collection changes to get instant updates when:

- A new generation is created
- A voice is added or modified
- Download progress updates (via Hono SSE, not PocketBase)
