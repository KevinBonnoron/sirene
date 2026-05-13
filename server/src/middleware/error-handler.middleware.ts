import type { Context } from 'hono';
import { ServiceError } from '../errors';

/** Single global error handler registered via `app.onError(...)`. Routes can
 *  let `ServiceError`s bubble up naturally and stay free of try/catch +
 *  `mapServiceError` boilerplate.
 *
 *  Anything that isn't a `ServiceError` collapses to a generic 500 - domain
 *  code should always raise a typed error so the HTTP shape is intentional,
 *  and we don't want to leak raw Error.message strings (stack-trace fragments,
 *  internal paths) to API clients. The thrown value is logged so the operator
 *  can still triage it. */
export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof ServiceError) {
    // The client reads `code` for i18n (`errors.<code>`) and falls back to
    // `message` when no translation is registered. The full body is exposed
    // to consumers via `HttpError.body` (universal-client >= 0.2).
    return c.json({ code: err.code, message: err.message }, err.status);
  }
  console.error('[errorHandler] unhandled', err);
  return c.json({ code: 'internal', message: 'Internal error' }, 500);
}
