export interface WordAlignment {
  /** Word index in the sequence (stable key within a single alignment). */
  index: number;
  text: string;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
}

export interface GenerationAlignment {
  generationId: string;
  duration: number;
  words: WordAlignment[];
  /** True when the timestamps are stubbed (uniform distribution) rather than from a real aligner. */
  stubbed?: boolean;
}
