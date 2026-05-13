/** Address of one inference worker. The router resolves a fresh `InferenceTarget`
 *  per call (least-loaded among healthy servers) and hands it to the repository
 *  factory, so the same repository code transparently dispatches across workers. */
export interface InferenceTarget {
  url: string;
  authToken?: string;
}

export interface InferenceRequest {
  backend: string;
  text: string;
  modelPath: string;
  voicePath?: string;
  referenceAudio?: string[];
  /** base64 data URIs, sent on cache miss retry */
  referenceAudioData?: string[];
  referenceCacheKey?: string;
  referenceText?: string[];
  instructText?: string;
  instructGender?: string;
  speed?: number;
  /** Generation-level noise / variation. Only Piper consumes this today (maps to noise_scale). */
  noiseScale?: number;
  language?: string;
}

export interface StreamingAudioResponse {
  body: ReadableStream<Uint8Array>;
  sampleRate: number;
}

export interface PullModelOptions {
  backend: string;
  modelId: string;
  files: { url: string; path: string }[];
  totalSize: number;
  hfToken?: string;
}
