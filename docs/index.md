---
layout: home

hero:
  name: Sirene
  text: Multi-backend TTS Router
  tagline: A single entry point to generate speech via Kokoro, Qwen3-TTS, F5-TTS, Piper, and more — with custom voice management via audio samples.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /reference/api-server

features:
  - title: Multi-Backend
    details: Route text-to-speech requests to Kokoro, Qwen3-TTS, F5-TTS, Piper, CosyVoice, OpenAudio, or Chatterbox from a single API.
  - title: Custom Voices
    details: Create custom voices by uploading audio samples. Automatic transcription via Whisper, waveform preview, and zero-shot voice cloning.
  - title: Model Management
    details: Download TTS models on demand from the web interface. Models are lazy-loaded into GPU memory with LRU eviction.
  - title: Real-time Updates
    details: Track model downloads and generation progress in real-time via Server-Sent Events powered by PocketBase.
  - title: Self-Hosted
    details: Run everything locally with Docker. All services (Nginx, Hono, FastAPI, PocketBase) bundled in a single container.
  - title: Open Source
    details: MIT licensed. Built with Bun, Hono, FastAPI, React, and PocketBase.
---
