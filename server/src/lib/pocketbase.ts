import PocketBase from 'pocketbase';
import { config } from './config';

export const pb = new PocketBase(config.pb.url).autoCancellation(false);

// Bootstrap can race PocketBase in docker-compose / k8s: Hono may start before
// the PB container finishes listening, and the resulting `fetch failed` would
// permanently break the server unless we retry until PB answers.
const PB_BOOTSTRAP_TIMEOUT_MS = 60_000;
const PB_BOOTSTRAP_INITIAL_DELAY_MS = 250;
const PB_BOOTSTRAP_MAX_DELAY_MS = 5_000;

/** Returns the HTTP status PB attached to the error (4xx/5xx), or `null` if the
 *  failure was at the transport layer (PB unreachable). PB's JS client reports
 *  `status === 0` for client-side / network errors. */
function pbErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') {
    return null;
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number' && status > 0) {
    return status;
  }
  return null;
}

export async function initPocketBase() {
  const deadline = Date.now() + PB_BOOTSTRAP_TIMEOUT_MS;
  let delay = PB_BOOTSTRAP_INITIAL_DELAY_MS;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await pb.collection('_superusers').authWithPassword(config.pb.adminEmail, config.pb.adminPassword);
      console.log('PocketBase admin authenticated');
      return;
    } catch (err) {
      const status = pbErrorStatus(err);
      if (status !== null) {
        // PB responded with an HTTP error: 4xx means it's up but auth is
        // misconfigured (wrong creds, superuser collection disabled, etc.).
        // That's an operator problem we can't fix by retrying, and the rest
        // of the server can still serve requests that don't need a superuser
        // session, so we log and proceed.
        console.warn(`PocketBase admin auth failed (status=${status}), continuing without auth`);
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`PocketBase at ${config.pb.url} did not become reachable within ${PB_BOOTSTRAP_TIMEOUT_MS / 1000}s (last error: ${err instanceof Error ? err.message : String(err)})`);
      }
      console.warn(`[pb] not reachable yet (attempt ${attempt}), retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, PB_BOOTSTRAP_MAX_DELAY_MS);
    }
  }
}
