import i18n from 'i18next';
import { HttpError } from 'universal-client';

/** Translate an API error into a user-readable string.
 *  The server emits `{ code, message }`; universal-client surfaces the parsed
 *  body on `HttpError.body`. We look up `errors.<code>` first, then fall back
 *  to the server-supplied English message, then the caller-supplied fallback. */
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
