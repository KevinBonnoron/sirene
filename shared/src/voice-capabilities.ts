export interface VoiceCapabilities {
  speed: boolean;
  pitch: boolean;
  variation: boolean;
  perWordSpeed: boolean;
}

// Pitch, and speed on backends with no native control, are applied to the rendered signal
// by the worker, so every local backend offers both. The cloud providers never reach the
// worker and only expose what their own API takes.
const LOCAL: VoiceCapabilities = { speed: true, pitch: true, variation: true, perWordSpeed: false };
const CLOUD: VoiceCapabilities = { speed: true, pitch: false, variation: false, perWordSpeed: false };

const CAPABILITIES: Record<string, VoiceCapabilities> = {
  piper: LOCAL,
  qwen: LOCAL,
  voxtral: LOCAL,
  // ONNX inference is deterministic: the same input always yields the same take.
  kokoro: { ...LOCAL, variation: false },
  chatterbox: LOCAL,
  cosyvoice: LOCAL,
  f5tts: LOCAL,
  higgs_audio: LOCAL,
  fish_audio: LOCAL,
  elevenlabs: CLOUD,
  openai: CLOUD,
};

export function getVoiceCapabilities(backend: string | undefined | null): VoiceCapabilities {
  if (!backend) {
    return { speed: false, pitch: false, variation: false, perWordSpeed: false };
  }
  return CAPABILITIES[backend] ?? LOCAL;
}

// Deliberately not keyed on `pitch`: a global pitch offset is post-processing, while the
// per-word panel edits a pitch curve and per-word rates that no backend consumes yet.
export function hasPerWordTuning(capabilities: VoiceCapabilities): boolean {
  return capabilities.perWordSpeed;
}
