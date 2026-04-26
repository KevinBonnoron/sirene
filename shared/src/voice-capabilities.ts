/**
 * Per-backend audio-tuning capabilities.
 *
 * The Studio surfaces three "global" tuning knobs (speed, pitch, variation), but most TTS
 * backends only honour a subset. We disable the sliders that have no effect rather than
 * pretending — and refuse to fake pitch shift via post-processing (the user explicitly
 * called this out).
 */
export interface VoiceCapabilities {
  /** Global speed / length-scale (1.0 = normal). Effectively universal. */
  speed: boolean;
  /** Native pitch shift in semitones (Global mode + per-word curve). No backend supports this without DSP today. */
  pitch: boolean;
  /** Generation-level random variation (Piper's noise_scale, model temperature, etc.). */
  variation: boolean;
  /** Per-word speed multiplier — needs SSML `<prosody rate>` support or token-level rate. None of our backends do today. */
  perWordSpeed: boolean;
}

const NONE: VoiceCapabilities = { speed: false, pitch: false, variation: false, perWordSpeed: false };
const SPEED_ONLY: VoiceCapabilities = { speed: true, pitch: false, variation: false, perWordSpeed: false };

const CAPABILITIES: Record<string, VoiceCapabilities> = {
  piper: { speed: true, pitch: false, variation: true, perWordSpeed: false },
  qwen: SPEED_ONLY,
  voxtral: NONE,
  kokoro: SPEED_ONLY,
  chatterbox: SPEED_ONLY,
  cosyvoice: SPEED_ONLY,
  f5tts: SPEED_ONLY,
  higgs_audio: SPEED_ONLY,
  openaudio: SPEED_ONLY,
  elevenlabs: SPEED_ONLY,
  openai: SPEED_ONLY,
};

/**
 * Returns the tuning capabilities for a given TTS backend id.
 * Unknown backends default to "speed only" — safest baseline.
 */
export function getVoiceCapabilities(backend: string | undefined | null): VoiceCapabilities {
  if (!backend) {
    return NONE;
  }
  return CAPABILITIES[backend] ?? SPEED_ONLY;
}

/** True when there's at least one editable per-word lane for this voice. Drives the "Par mot" tab availability. */
export function hasPerWordTuning(capabilities: VoiceCapabilities): boolean {
  return capabilities.pitch || capabilities.perWordSpeed;
}
