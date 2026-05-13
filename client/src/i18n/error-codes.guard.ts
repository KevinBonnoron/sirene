import type { ErrorCode } from '@sirene/shared';
import en from './locales/en.json';
import fr from './locales/fr.json';

/** Build-time check: every `ErrorCode` defined on the server must have a
 *  translation entry in every locale. Adding a code on the server side without
 *  updating the locale files causes a TypeScript error here, so the drift
 *  can't sneak into prod. The variables are unused at runtime but the
 *  assignment forces the type-check. */
type ErrorTranslations = Record<ErrorCode, string>;

const _enErrors: ErrorTranslations = en.errors;
const _frErrors: ErrorTranslations = fr.errors;

// Suppress "unused" hints without exposing internals.
void _enErrors;
void _frErrors;
