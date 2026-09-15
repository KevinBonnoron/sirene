import type { JSONContent } from '@tiptap/core';

export function contentToSSML(doc: JSONContent): string {
  return (doc.content ?? [])
    .map((para) =>
      (para.content ?? [])
        .map((node) => {
          if (node.type === 'effectNode') {
            return `[${node.attrs?.effect ?? ''}]`;
          }
          if (node.type !== 'text') {
            return '';
          }
          const text = node.text ?? '';
          const speedMark = node.marks?.find((m) => m.type === 'speedMark');
          const toneMark = node.marks?.find((m) => m.type === 'toneMark');
          if (speedMark || toneMark) {
            const attrs = [speedMark ? `rate="${speedMark.attrs?.rate}"` : '', toneMark ? `tone="${toneMark.attrs?.tone}"` : ''].filter(Boolean).join(' ');
            return `<prosody ${attrs}>${text}</prosody>`;
          }
          return text;
        })
        .join(''),
    )
    .join('\n');
}

export function stripSSML(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\[[^\]]+\]/g, '');
}

// Tiptap splits a word into adjacent text nodes when marks change, so only block boundaries get a separator.
const TIPTAP_BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem']);

export function countWords(doc: JSONContent): number {
  const blocks: string[] = [];
  let buffer = '';
  const walk = (node?: JSONContent): void => {
    if (!node || node.type === 'effectNode') {
      return;
    }
    if (node.type === 'text' && typeof node.text === 'string') {
      buffer += node.text;
      return;
    }
    const isBlock = node.type ? TIPTAP_BLOCK_TYPES.has(node.type) : false;
    for (const child of node.content ?? []) {
      walk(child);
    }
    if (isBlock && buffer.length > 0) {
      blocks.push(buffer);
      buffer = '';
    }
  };
  walk(doc);
  if (buffer.length > 0) {
    blocks.push(buffer);
  }
  const plain = blocks.join(' ').trim();
  return plain ? plain.split(/\s+/).filter(Boolean).length : 0;
}

const WORDS_PER_SECOND = 3;

export function estimateSpeechDuration(wordCount: number, speedMultiplier = 1): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) {
    return 0;
  }
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    return wordCount / WORDS_PER_SECOND;
  }
  return wordCount / (WORDS_PER_SECOND * speedMultiplier);
}
