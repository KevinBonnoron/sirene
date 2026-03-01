import type { Voice } from '@sirene/shared';

export interface PendingSample {
  id: string;
  file: File;
  transcript: string;
  transcribing: boolean;
}

let nextId = 0;
export function getNextSampleId(): string {
  return `pending-${nextId++}`;
}

export type VoiceFormState = {
  internalOpen: boolean;
  loading: boolean;
  name: string;
  description: string;
  language: string;
  modelId: string;
  presetVoice: string;
  avatarFile: File | null;
  clearAvatar: boolean;
  pendingSamples: PendingSample[];
  deletedSampleIds: string[];
  tags: string[];
  tagInput: string;
  isPublic: boolean;
};

export type VoiceFormAction =
  | { type: 'setOpen'; value: boolean }
  | { type: 'setLoading'; value: boolean }
  | { type: 'setName'; value: string }
  | { type: 'setDescription'; value: string }
  | { type: 'setLanguage'; value: string }
  | { type: 'setModelId'; value: string }
  | { type: 'setPresetVoice'; value: string }
  | { type: 'setAvatar'; file: File }
  | { type: 'clearAvatar' }
  | { type: 'addPendingSamples'; samples: PendingSample[] }
  | { type: 'removePendingSample'; id: string }
  | { type: 'updatePendingTranscript'; id: string; transcript: string }
  | { type: 'setPendingSampleTranscribing'; id: string; value: boolean }
  | { type: 'addDeletedSample'; id: string }
  | { type: 'setTags'; tags: string[] }
  | { type: 'setTagInput'; value: string }
  | { type: 'setIsPublic'; value: boolean }
  | { type: 'resetTransient' }
  | { type: 'resetForm'; voice?: Voice };

export function makeInitialState(voice?: Voice): VoiceFormState {
  return {
    internalOpen: false,
    loading: false,
    name: voice?.name ?? '',
    description: voice?.description ?? '',
    language: voice?.language ?? 'en',
    modelId: voice?.model ?? '',
    presetVoice: (voice?.options?.presetVoice as string) ?? '',
    avatarFile: null,
    clearAvatar: false,
    pendingSamples: [],
    deletedSampleIds: [],
    tags: voice?.tags ?? [],
    tagInput: '',
    isPublic: voice?.public ?? false,
  };
}

export function voiceFormReducer(state: VoiceFormState, action: VoiceFormAction): VoiceFormState {
  switch (action.type) {
    case 'setOpen':
      return { ...state, internalOpen: action.value };
    case 'setLoading':
      return { ...state, loading: action.value };
    case 'setName':
      return { ...state, name: action.value };
    case 'setDescription':
      return { ...state, description: action.value };
    case 'setLanguage':
      return { ...state, language: action.value };
    case 'setModelId':
      return { ...state, modelId: action.value };
    case 'setPresetVoice':
      return { ...state, presetVoice: action.value };
    case 'setAvatar':
      return { ...state, avatarFile: action.file, clearAvatar: false };
    case 'clearAvatar':
      return { ...state, avatarFile: null, clearAvatar: true };
    case 'addPendingSamples':
      return { ...state, pendingSamples: [...state.pendingSamples, ...action.samples] };
    case 'removePendingSample':
      return { ...state, pendingSamples: state.pendingSamples.filter((s) => s.id !== action.id) };
    case 'updatePendingTranscript':
      return { ...state, pendingSamples: state.pendingSamples.map((s) => (s.id === action.id ? { ...s, transcript: action.transcript } : s)) };
    case 'setPendingSampleTranscribing':
      return { ...state, pendingSamples: state.pendingSamples.map((s) => (s.id === action.id ? { ...s, transcribing: action.value } : s)) };
    case 'addDeletedSample':
      return { ...state, deletedSampleIds: [...state.deletedSampleIds, action.id] };
    case 'setTags':
      return { ...state, tags: action.tags };
    case 'setTagInput':
      return { ...state, tagInput: action.value };
    case 'setIsPublic':
      return { ...state, isPublic: action.value };
    case 'resetTransient':
      return { ...state, avatarFile: null, clearAvatar: false, pendingSamples: [], deletedSampleIds: [], tagInput: '' };
    case 'resetForm':
      return makeInitialState(action.voice);
  }
}
