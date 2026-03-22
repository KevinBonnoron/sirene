import { Mark, mergeAttributes, Node } from '@tiptap/core';
import { getSpeedStyle } from '@/utils/ssml';

const TONE_STYLE = ['background: oklch(0.55 0.2 290 / 0.35)', 'border: 1px solid oklch(0.65 0.22 290 / 0.55)', 'border-radius: 4px', 'padding: 1px 4px'].join('; ');

const EFFECT_BADGE_STYLE = ['display: inline-block', 'background: oklch(0.5 0.0 0 / 0.12)', 'border: 1px solid oklch(0.5 0.0 0 / 0.35)', 'border-radius: 4px', 'padding: 0 4px', 'font-size: 0.78em', 'font-family: monospace', 'line-height: 1.5', 'cursor: default', 'user-select: none', 'vertical-align: middle'].join(
  '; ',
);

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
