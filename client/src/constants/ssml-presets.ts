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
