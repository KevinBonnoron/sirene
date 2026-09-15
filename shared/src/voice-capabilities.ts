export interface VoiceCapabilities {
  speed: boolean;
  pitch: boolean;
  variation: boolean;
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

export function getVoiceCapabilities(backend: string | undefined | null): VoiceCapabilities {
  if (!backend) {
    return NONE;
  }
  return CAPABILITIES[backend] ?? SPEED_ONLY;
}

export function hasPerWordTuning(capabilities: VoiceCapabilities): boolean {
  return capabilities.pitch || capabilities.perWordSpeed;
}
