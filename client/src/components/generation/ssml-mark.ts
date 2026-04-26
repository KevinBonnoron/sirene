import { Mark, mergeAttributes, Node } from '@tiptap/core';
import './ssml-chip.css';

// ---------------------------------------------------------------------------
// SpeedMark — wraps text, controls rate (slow / fast / xfast)
// ---------------------------------------------------------------------------

function speedClass(rate: number | null | undefined): string {
  if (!Number.isFinite(rate)) {
    return 'ssml-chip';
  }
  if ((rate as number) < 1) {
    return 'ssml-chip ssml-chip-slow';
  }
  return 'ssml-chip ssml-chip-fast';
}

export const SpeedMark = Mark.create({
  name: 'speedMark',

  addAttributes() {
    return {
      rate: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-rate')),
        renderHTML: (attrs) => ({
          'data-rate': attrs.rate,
          class: speedClass(attrs.rate as number),
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
// ToneMark — wraps text, controls emotional tone (sage chip)
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
          class: 'ssml-chip ssml-chip-tone',
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
// EffectNode — inline atom: a sound effect or pause label rendered as a chip.
// ---------------------------------------------------------------------------

function effectClass(effect: string): string {
  if (effect === 'pause' || effect === 'long pause') {
    return 'ssml-chip ssml-chip-pause';
  }
  return 'ssml-chip ssml-chip-effect';
}

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
    const label = typeof node.attrs.label === 'string' ? node.attrs.label.trim() : '';
    const effect = typeof node.attrs.effect === 'string' ? node.attrs.effect.trim() : '';
    const display = label || effect;
    return [
      'span',
      {
        'data-effect': node.attrs.effect,
        'data-label': node.attrs.label,
        contenteditable: 'false',
        class: effectClass(node.attrs.effect as string),
      },
      display,
    ];
  },
});
