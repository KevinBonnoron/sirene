const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', minLength: 1 },
};

const pocketBaseProps = {
  id: { type: 'string' },
  collectionId: { type: 'string' },
  collectionName: { type: 'string' },
  created: { type: 'string', format: 'date-time' },
  updated: { type: 'string', format: 'date-time' },
};

export const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Sirene API',
    description: 'Text-to-speech generation API with voice cloning, model management, and streaming support.',
    version: '0.1.0',
  },
  servers: [{ url: '/api' }],

  tags: [
    { name: 'Health' },
    { name: 'Generate', description: 'Text-to-speech generation' },
    { name: 'Generations', description: 'Generation history' },
    { name: 'Voices', description: 'Voice management' },
    { name: 'Models', description: 'Model catalog and installation' },
    { name: 'Transcribe', description: 'Speech-to-text' },
    { name: 'Settings', description: 'API key and configuration management' },
  ],

  paths: {
    // ── Health & Version ──────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } } } } },
          },
        },
      },
    },
    '/version': {
      get: {
        tags: ['Health'],
        summary: 'API version',
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { version: { type: 'string' }, name: { type: 'string' } } },
              },
            },
          },
        },
      },
    },

    // ── Generate ──────────────────────────────────────────────────
    '/generate': {
      post: {
        tags: ['Generate'],
        summary: 'Generate speech',
        description: 'Generates audio from text using the specified voice. Returns a complete WAV file.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateRequest' } } } },
        responses: {
          200: { description: 'WAV audio', content: { 'audio/wav': { schema: { type: 'string', format: 'binary' } } } },
          400: { $ref: '#/components/responses/Error' },
          404: { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/generate/stream': {
      post: {
        tags: ['Generate'],
        summary: 'Generate speech (streaming)',
        description: 'Generates audio from text and streams raw PCM chunks as they are produced. Headers `X-Sample-Rate`, `X-Channels`, and `X-Bits-Per-Sample` describe the audio format.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateRequest' } } } },
        responses: {
          200: {
            description: 'Raw PCM audio stream (int16, mono)',
            headers: {
              'X-Sample-Rate': { schema: { type: 'integer', example: 24000 }, description: 'Sample rate in Hz' },
              'X-Channels': { schema: { type: 'integer', example: 1 }, description: 'Number of channels' },
              'X-Bits-Per-Sample': { schema: { type: 'integer', example: 16 }, description: 'Bits per sample' },
            },
            content: { 'audio/pcm': { schema: { type: 'string', format: 'binary' } } },
          },
          400: { $ref: '#/components/responses/Error' },
          404: { $ref: '#/components/responses/Error' },
        },
      },
    },

    // ── Generations ───────────────────────────────────────────────
    '/generations': {
      get: {
        tags: ['Generations'],
        summary: 'List generations',
        parameters: [
          { name: 'voice', in: 'query', schema: { type: 'string' }, description: 'Filter by voice ID' },
          { name: 'model', in: 'query', schema: { type: 'string' }, description: 'Filter by model ID' },
        ],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Generation' } } } },
          },
        },
      },
    },
    '/generations/{id}': {
      get: {
        tags: ['Generations'],
        summary: 'Get generation',
        parameters: [idParam],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Generation' } } } },
          404: { $ref: '#/components/responses/Error' },
        },
      },
      delete: {
        tags: ['Generations'],
        summary: 'Delete generation',
        parameters: [idParam],
        responses: { 204: { description: 'Deleted' } },
      },
    },

    // ── Voices ────────────────────────────────────────────────────
    '/voices': {
      get: {
        tags: ['Voices'],
        summary: 'List voices',
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Voice' } } } },
          },
        },
      },
      post: {
        tags: ['Voices'],
        summary: 'Create voice',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  language: { type: 'string' },
                  model: { type: 'string' },
                  options: { type: 'string', description: 'JSON-encoded options' },
                  avatar: { type: 'string', format: 'binary' },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Voice' } } } },
        },
      },
    },
    '/voices/import': {
      post: {
        tags: ['Voices'],
        summary: 'Import voice from ZIP',
        description: 'Imports a voice from a ZIP archive containing `voice.json`, optional avatar, and optional `samples/` directory.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { type: 'object', properties: { file: { type: 'string', format: 'binary', description: 'ZIP archive' } }, required: ['file'] },
            },
          },
        },
        responses: {
          201: { description: 'Imported', content: { 'application/json': { schema: { $ref: '#/components/schemas/Voice' } } } },
          400: { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/voices/{id}': {
      get: {
        tags: ['Voices'],
        summary: 'Get voice',
        parameters: [idParam],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Voice' } } } },
          404: { $ref: '#/components/responses/Error' },
        },
      },
      put: {
        tags: ['Voices'],
        summary: 'Update voice',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  language: { type: 'string' },
                  model: { type: 'string' },
                  options: { type: 'string', description: 'JSON-encoded options' },
                  avatar: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Voice' } } } },
        },
      },
      delete: {
        tags: ['Voices'],
        summary: 'Delete voice',
        parameters: [idParam],
        responses: { 204: { description: 'Deleted' } },
      },
    },
    '/voices/{id}/export': {
      get: {
        tags: ['Voices'],
        summary: 'Export voice as ZIP',
        parameters: [idParam],
        responses: {
          200: {
            description: 'ZIP archive',
            content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
          },
          404: { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/voices/{id}/samples': {
      get: {
        tags: ['Voices'],
        summary: 'List voice samples',
        parameters: [idParam],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/VoiceSample' } } } },
          },
        },
      },
      post: {
        tags: ['Voices'],
        summary: 'Upload voice sample',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  audio: { type: 'string', format: 'binary', description: 'Audio file' },
                  transcript: { type: 'string', description: 'Transcript of the audio' },
                },
                required: ['audio'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/VoiceSample' } } } },
          400: { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/voices/{id}/samples/{sampleId}': {
      delete: {
        tags: ['Voices'],
        summary: 'Delete voice sample',
        parameters: [idParam, { name: 'sampleId', in: 'path', required: true, schema: { type: 'string', minLength: 1 } }],
        responses: {
          204: { description: 'Deleted' },
          404: { $ref: '#/components/responses/Error' },
        },
      },
    },

    // ── Models ────────────────────────────────────────────────────
    '/models/catalog': {
      get: {
        tags: ['Models'],
        summary: 'List model catalog',
        description: 'Returns the full model catalog (built-in + custom Piper models).',
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/CatalogModel' } } } },
          },
        },
      },
    },
    '/models/installed': {
      get: {
        tags: ['Models'],
        summary: 'List installed models',
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Model' } } } },
          },
        },
      },
    },
    '/models/{id}/pull': {
      get: {
        tags: ['Models'],
        summary: 'Download model (SSE)',
        description: 'Starts downloading the model and streams progress via Server-Sent Events.',
        parameters: [idParam],
        responses: {
          200: {
            description: 'SSE stream with `progress`, `complete`, and `error` events',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
          400: { $ref: '#/components/responses/Error' },
          404: { $ref: '#/components/responses/Error' },
          409: { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/models/{id}': {
      delete: {
        tags: ['Models'],
        summary: 'Delete model',
        parameters: [idParam],
        responses: { 204: { description: 'Deleted' } },
      },
    },
    '/models/piper/import': {
      post: {
        tags: ['Models'],
        summary: 'Import custom Piper model',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  onnx: { type: 'string', format: 'binary', description: 'ONNX model file' },
                  config: { type: 'string', format: 'binary', description: 'Piper JSON config' },
                  name: { type: 'string', description: 'Model name (used as slug)' },
                },
                required: ['onnx', 'config', 'name'],
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Imported',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { id: { type: 'string' }, message: { type: 'string' } } },
              },
            },
          },
          400: { $ref: '#/components/responses/Error' },
          409: { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/models/{id}/export': {
      get: {
        tags: ['Models'],
        summary: 'Export custom model as ZIP',
        parameters: [idParam],
        responses: {
          200: { description: 'ZIP archive', content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } },
          404: { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/models/events': {
      get: {
        tags: ['Models'],
        summary: 'Model change events (SSE)',
        description: 'Streams model installation changes via Server-Sent Events. Stays open until the client disconnects.',
        responses: {
          200: {
            description: 'SSE stream with `change` events containing installation status',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },

    // ── Settings ─────────────────────────────────────────────────
    '/settings': {
      get: {
        tags: ['Settings'],
        summary: 'List settings',
        description: 'Returns all settings with masked values.',
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object', properties: { key: { type: 'string' }, maskedValue: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      put: {
        tags: ['Settings'],
        summary: 'Update setting',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { key: { type: 'string' }, value: { type: 'string' } },
                required: ['key', 'value'],
              },
            },
          },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
        },
      },
    },
    '/settings/{key}': {
      delete: {
        tags: ['Settings'],
        summary: 'Delete setting',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
        },
      },
    },

    // ── Transcribe ────────────────────────────────────────────────
    '/transcribe': {
      post: {
        tags: ['Transcribe'],
        summary: 'Transcribe audio',
        description: 'Transcribes an audio file using the installed Whisper model.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { audio: { type: 'string', format: 'binary', description: 'Audio file to transcribe' } },
                required: ['audio'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { text: { type: 'string' }, language: { type: 'string' } },
                  required: ['text'],
                },
              },
            },
          },
          400: { $ref: '#/components/responses/Error' },
          502: { $ref: '#/components/responses/Error' },
        },
      },
    },
  },

  components: {
    schemas: {
      GenerateRequest: {
        type: 'object',
        properties: {
          voice: { type: 'string', minLength: 1, description: 'Voice ID' },
          input: { type: 'string', minLength: 1, description: 'Text to synthesize' },
          speed: { type: 'number', minimum: 0.1, maximum: 5, default: 1, description: 'Playback speed multiplier' },
        },
        required: ['voice', 'input'],
      },
      Generation: {
        type: 'object',
        properties: {
          ...pocketBaseProps,
          voice: { type: 'string' },
          model: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string' },
          audio: { type: 'string', description: 'PocketBase file path' },
          duration: { type: 'number' },
          speed: { type: 'number' },
        },
      },
      Voice: {
        type: 'object',
        properties: {
          ...pocketBaseProps,
          name: { type: 'string' },
          description: { type: 'string' },
          language: { type: 'string' },
          avatar: { type: 'string' },
          model: { type: 'string' },
          options: { type: 'object', additionalProperties: true },
        },
      },
      VoiceSample: {
        type: 'object',
        properties: {
          ...pocketBaseProps,
          voice: { type: 'string' },
          audio: { type: 'string', description: 'PocketBase file path' },
          transcript: { type: 'string' },
          duration: { type: 'number' },
        },
      },
      CatalogModel: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          backend: { type: 'string' },
          backendDescription: { type: 'string' },
          description: { type: 'string' },
          repo: { type: 'string' },
          files: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object', properties: { path: { type: 'string' }, repo: { type: 'string' } } }] } },
          size: { type: 'integer', description: 'Size in bytes' },
          type: { type: 'string', enum: ['preset', 'cloning', 'transcription', 'api'] },
          presetVoices: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } } },
          },
          gated: { type: 'boolean', description: 'Requires HuggingFace token' },
        },
      },
      Model: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pulling', 'installed', 'error'] },
          progress: { type: 'number', minimum: 0, maximum: 100 },
          error: { type: 'string' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          error: { type: 'string' },
        },
      },
    },
    responses: {
      Error: {
        description: 'Error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
};
