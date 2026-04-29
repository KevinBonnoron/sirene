/** Shared helper to extract a human-readable message from an API or fetch error.
 *  The Hono server returns errors as `{ message: string }` JSON; the universal-client
 *  serialises them onto the thrown error object's `.message` property. */
export function explainApiError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return err instanceof Error ? err.message : fallback;
}
