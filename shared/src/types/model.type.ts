/** A file to download — either a plain path (uses the model repo) or an object with a custom repo.
 *  Use `remotePath` when the HF file path differs from the desired local path. */
export type CatalogFile = string | { path: string; repo?: string; remotePath?: string };

/** Preset models have built-in voices; cloning models need audio samples; design models create voices from text descriptions; transcription models are used for STT. */
export type CatalogModelType = 'preset' | 'cloning' | 'design' | 'transcription' | 'api';

export interface PresetVoice {
  id: string;
  label: string;
  description?: string;
}

/** Catalog entry — available for download (from the manifest) */
export interface CatalogModel {
  id: string;
  name: string;
  /** The backend that implements this model. */
  backend: string;
  /** Human-readable display name for the backend (e.g. "Kokoro", "ElevenLabs"). */
  backendDisplayName: string;
  /** Short description of the backend (shared across models of the same backend). */
  backendDescription: string;
  /** Short description of the model. */
  description: string;
  repo: string;
  files: CatalogFile[];
  size: number;
  types: CatalogModelType[];
  presetVoices?: PresetVoice[];
  /** Maximum reference audio duration in seconds for voice cloning backends. */
  maxReferenceDuration?: number;
  /** Model requires a HuggingFace token (gated repo). */
  gated?: boolean;
  /** Language code (e.g. "fr", "en") — mainly for Piper custom imports. */
  language?: string;
  /** Supports instruct_text for emotional tone control (e.g. CosyVoice, Qwen, HiggsAudio). */
  supportsInstruct?: boolean;
  /** Supports bracket effect tokens like [laughing] passed as literal text (e.g. Fish Speech). */
  supportsEffects?: boolean;
}

/** Installation record — derived from filesystem + in-memory download state */
export type ModelStatus = 'pulling' | 'installed' | 'error';

export interface Model {
  id: string;
  status: ModelStatus;
  progress: number;
  error?: string;
  /** Server ids where the model is currently installed. Empty when not installed anywhere. */
  serverIds: string[];
}
