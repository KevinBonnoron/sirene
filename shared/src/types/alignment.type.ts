export interface WordAlignment {
  index: number;
  text: string;
  start: number;
  end: number;
}

export interface GenerationAlignment {
  generationId: string;
  duration: number;
  words: WordAlignment[];
  stubbed?: boolean;
}
