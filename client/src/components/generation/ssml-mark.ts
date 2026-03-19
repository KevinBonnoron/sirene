import type { JSONContent } from '@tiptap/core';
import { Mark, mergeAttributes, Node } from '@tiptap/core';

// ---------------------------------------------------------------------------
// Presets config
// ---------------------------------------------------------------------------

export const SPEED_PRESETS = [
  { key: 'slow', rate: 0.75, labelKey: 'generate.speedSlow' },
  { key: 'fast', rate: 1.25, labelKey: 'generate.speedFast' },
  { key: 'xFast', rate: 1.5, labelKey: 'generate.speedXFast' },
] as const;

export const TONE_PRESETS = [
  { key: 'angry', labelKey: 'generate.toneAngry' },
  { key: 'sad', labelKey: 'generate.toneSad' },
  { key: 'happy', labelKey: 'generate.toneHappy' },
  { key: 'excited', labelKey: 'generate.toneExcited' },
  { key: 'embarrassed', labelKey: 'generate.toneEmbarrassed' },
  { key: 'whispering', labelKey: 'generate.toneWhispering' },
  { key: 'soft', labelKey: 'generate.toneSoft' },
  { key: 'breathy', labelKey: 'generate.toneBreathy' },
] as const;

export const PAUSE_PRESETS = [
  { key: 'pause', labelKey: 'generate.effectPause' },
  { key: 'long pause', labelKey: 'generate.effectLongPause' },
] as const;

export const SOUND_EFFECT_PRESETS = [
  { key: 'laughing', labelKey: 'generate.effectLaughing' },
  { key: 'chuckling', labelKey: 'generate.effectChuckling' },
  { key: 'sighing', labelKey: 'generate.effectSighing' },
  { key: 'crying', labelKey: 'generate.effectCrying' },
  { key: 'moaning', labelKey: 'generate.effectMoaning' },
  { key: 'groaning', labelKey: 'generate.effectGroaning' },
] as const;

export type SpeedKey = (typeof SPEED_PRESETS)[number]['key'];
export type ToneKey = (typeof TONE_PRESETS)[number]['key'];
export type EffectKey = (typeof PAUSE_PRESETS)[number]['key'] | (typeof SOUND_EFFECT_PRESETS)[number]['key'];

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

function getSpeedColor(rate: number): string {
  if (rate < 1.0) {
    return 'oklch(0.72 0.22 230)'; // blue — slow
  }
  if (rate <= 1.25) {
    return 'oklch(0.80 0.18 55)'; // amber — fast
  }
  return 'oklch(0.72 0.24 25)'; // red — x-fast
}

function getSpeedStyle(rate: number): string {
  const color = getSpeedColor(rate);
  return `color: ${color}; font-weight: 500;`;
}

const TONE_STYLE = ['background: oklch(0.55 0.2 290 / 0.35)', 'border: 1px solid oklch(0.65 0.22 290 / 0.55)', 'border-radius: 4px', 'padding: 1px 4px'].join('; ');

const EFFECT_BADGE_STYLE = ['display: inline-block', 'background: oklch(0.5 0.0 0 / 0.12)', 'border: 1px solid oklch(0.5 0.0 0 / 0.35)', 'border-radius: 4px', 'padding: 0 4px', 'font-size: 0.78em', 'font-family: monospace', 'line-height: 1.5', 'cursor: default', 'user-select: none', 'vertical-align: middle'].join(
  '; ',
);

export function getSpeedBorderColor(rate: number): string {
  return getSpeedColor(rate);
}

export const TONE_BORDER_COLOR = 'oklch(0.75 0.2 290)';

// ---------------------------------------------------------------------------
// SpeedMark — wraps text, controls rate
// ---------------------------------------------------------------------------

export const SpeedMark = Mark.create({
  name: 'speedMark',

  addAttributes() {
    return {
      rate: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-rate')),
        renderHTML: (attrs) => ({
          'data-rate': attrs.rate,
          style: getSpeedStyle(attrs.rate as number),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-rate]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});

// ---------------------------------------------------------------------------
// ToneMark — wraps text, controls emotional tone
// ---------------------------------------------------------------------------

export const ToneMark = Mark.create({
  name: 'toneMark',

  addAttributes() {
    return {
      tone: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-tone'),
        renderHTML: (attrs) => ({
          'data-tone': attrs.tone,
          style: TONE_STYLE,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-tone]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});

// ---------------------------------------------------------------------------
// EffectNode — inline atom, inserts a sound/pause marker at cursor
// ---------------------------------------------------------------------------

export const EffectNode = Node.create({
  name: 'effectNode',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      effect: { default: 'pause' },
      label: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-effect]',
        getAttrs: (el) => ({
          effect: (el as HTMLElement).getAttribute('data-effect'),
          label: (el as HTMLElement).getAttribute('data-label'),
        }),
      },
    ];
  },

  renderHTML({ node }) {
    const display = node.attrs.label ?? node.attrs.effect;
    return [
      'span',
      {
        'data-effect': node.attrs.effect,
        'data-label': node.attrs.label,
        contenteditable: 'false',
        style: EFFECT_BADGE_STYLE,
      },
      `[${display}]`,
    ];
  },
});

// ---------------------------------------------------------------------------
// SSML ↔ TipTap JSON conversion
// ---------------------------------------------------------------------------
// Internal format:
//   Speed only:      <prosody rate="0.75">text</prosody>
//   Tone only:       <prosody tone="angry">text</prosody>
//   Speed + Tone:    <prosody rate="0.75" tone="angry">text</prosody>
//   Effects:         [pause]  [laughing]  etc.
// ---------------------------------------------------------------------------

const RATE_MAP: Record<string, number> = {
  'x-slow': 0.5,
  slow: 0.75,
  medium: 1.0,
  fast: 1.25,
  'x-fast': 1.5,
};

function parseRateToFloat(raw: string): number {
  const s = raw.trim();
  if (s in RATE_MAP) {
    return RATE_MAP[s];
  }
  const rel = s.match(/^([+-])(\d+(?:\.\d+)?)%$/);
  if (rel) {
    const sign = rel[1] === '+' ? 1 : -1;
    return Math.max(0.1, 1.0 + (sign * Number(rel[2])) / 100);
  }
  const abs = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (abs) {
    return Math.max(0.1, Number(abs[1]) / 100);
  }
  const n = Number(s);
  return Number.isNaN(n) ? 1.0 : Math.max(0.1, n);
}

/** Convert SSML/marker string to TipTap JSONContent. */
export function ssmlToContent(text: string): JSONContent {
  // Matches <prosody ...>content</prosody>  OR  [effect]
  const pattern = /(<prosody\b([^>]*)>([\s\S]*?)<\/prosody>|\[([^\]]+)\])/gi;

  const buildNodes = (line: string): JSONContent[] => {
    const nodes: JSONContent[] = [];
    let last = 0;
    pattern.lastIndex = 0;

    let match = pattern.exec(line);
    while (match !== null) {
      if (match.index > last) {
        nodes.push({ type: 'text', text: line.slice(last, match.index) });
      }

      if (match[1].startsWith('<')) {
        // <prosody ...>content</prosody>
        const attrsStr = match[2];
        const content = match[3];
        const marks: NonNullable<JSONContent['marks']> = [];

        const rateMatch = attrsStr.match(/\brate=["']([^"']+)["']/);
        if (rateMatch) {
          marks.push({ type: 'speedMark', attrs: { rate: parseRateToFloat(rateMatch[1]) } });
        }

        const toneMatch = attrsStr.match(/\btone=["']([^"']+)["']/);
        if (toneMatch) {
          marks.push({ type: 'toneMark', attrs: { tone: toneMatch[1] } });
        }

        nodes.push(marks.length > 0 ? { type: 'text', text: content, marks } : { type: 'text', text: content });
      } else {
        // [effect]
        nodes.push({ type: 'effectNode', attrs: { effect: match[4] } });
      }

      last = match.index + match[0].length;
      match = pattern.exec(line);
    }

    const tail = line.slice(last);
    if (tail) {
      nodes.push({ type: 'text', text: tail });
    }

    return nodes;
  };

  const paragraphs = text.split('\n').map((line) => ({
    type: 'paragraph',
    content: buildNodes(line),
  })) satisfies JSONContent[];

  return { type: 'doc', content: paragraphs };
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
