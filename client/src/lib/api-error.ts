import i18n from 'i18next';
import { HttpError } from 'universal-client';

export function explainApiError(err: unknown, fallback: string): string {
  if (err instanceof HttpError) {
    const body = err.body as { code?: string; message?: string } | null;
    if (body?.code) {
      const translated = i18n.t(`errors.${body.code}`, { defaultValue: '' });
      if (translated) {
        return translated;
      }
    }
    if (body?.message) {
      return body.message;
    }
    return err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}
