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
  license?: string;
  /** undefined means unknown */
  commercial?: boolean;
  /** cpu: runs comfortably on CPU; gpu: a GPU is recommended */
  hardware?: 'cpu' | 'gpu';
  /** GB, only when the upstream documents a figure */
  minVram?: number;
  /** ISO 639-1 codes; "*" means 100+ languages */
  languages?: string[];
  recommended?: boolean;
  legacy?: boolean;
}

export type ModelStatus = 'pulling' | 'installed' | 'error' | 'missing';

export interface Model {
  id: string;
  status: ModelStatus;
  progress: number;
  error?: string;
  serverIds: string[];
  /** Asked for by the operator, as opposed to merely observed on a worker. */
  wanted: boolean;
}
