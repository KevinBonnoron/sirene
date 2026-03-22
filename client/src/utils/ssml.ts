import type { JSONContent } from '@tiptap/core';

function getSpeedColor(rate: number): string {
  if (rate < 1.0) {
    return 'oklch(0.72 0.22 230)'; // blue — slow
  }
  if (rate <= 1.25) {
    return 'oklch(0.80 0.18 55)'; // amber — fast
  }
  return 'oklch(0.72 0.24 25)'; // red — x-fast
}

export function getSpeedStyle(rate: number): string {
  const color = getSpeedColor(rate);
  return `color: ${color}; font-weight: 500;`;
}

export function getSpeedBorderColor(rate: number): string {
  return getSpeedColor(rate);
}

/** Convert TipTap JSONContent back to the internal SSML/marker string. */
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

/** Strip all SSML/marker syntax, returning plain text only. */
export function stripSSML(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\[[^\]]+\]/g, '');
}
