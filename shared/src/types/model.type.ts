export type CatalogFile = string | { path: string; repo?: string; remotePath?: string };

export type CatalogModelType = 'preset' | 'cloning' | 'design' | 'transcription' | 'api';

export interface PresetVoice {
  id: string;
  label: string;
  description?: string;
}

export interface CatalogModel {
  id: string;
  name: string;
  backend: string;
  backendDisplayName: string;
  backendDescription: string;
  description: string;
  repo: string;
  files: CatalogFile[];
  size: number;
  types: CatalogModelType[];
  presetVoices?: PresetVoice[];
  maxReferenceDuration?: number;
  gated?: boolean;
  language?: string;
  supportsInstruct?: boolean;
  supportsEffects?: boolean;
}

export type ModelStatus = 'pulling' | 'installed' | 'error';

export interface Model {
  id: string;
  status: ModelStatus;
  progress: number;
  error?: string;
  serverIds: string[];
}
