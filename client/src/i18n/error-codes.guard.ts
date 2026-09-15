import type { ErrorCode } from '@sirene/shared';
import en from './locales/en.json';
import fr from './locales/fr.json';

// Compile-time only: fails when a locale lacks a translation for a server `ErrorCode`.
type ErrorTranslations = Record<ErrorCode, string>;

const _enErrors: ErrorTranslations = en.errors;
const _frErrors: ErrorTranslations = fr.errors;

void _enErrors;
void _frErrors;
