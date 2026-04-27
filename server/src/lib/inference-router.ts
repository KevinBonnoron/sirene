import type { InferenceServer } from '@sirene/shared';
import { inferenceServerService } from '../services/inference-server.service';
import { serverModelsService } from '../services/server-models.service';

export class NoInferenceServerError extends Error {
  public constructor(message = 'No inference server is available') {
    super(message);
    this.name = 'NoInferenceServerError';
  }
}

/** In-flight call counts per server. Used by the router to pick the least-loaded
 *  candidate for a generation. Reset only on process restart — fine since these
 *  numbers are tracked per Hono process. */
const inFlight = new Map<string, number>();

interface PickOptions {
  /** Restrict candidates to servers that have this model installed. */
  requireModel?: string;
}

/** Pick a server for an outgoing call. Strategy:
 *  - Filter to enabled+online (or unknown if nothing online) servers
 *  - If `requireModel` is set, keep only servers that have it installed
 *  - Among candidates: pick the one with the fewest in-flight calls; ties broken by priority */
export async function pickServer(options: PickOptions = {}): Promise<InferenceServer> {
  const all = await inferenceServerService.listEnabled();
  if (all.length === 0) {
    throw new NoInferenceServerError('No inference server is configured. Add one from Settings.');
  }

  let candidates = all.filter((s) => s.last_health_status === 'online');
  if (candidates.length === 0) {
    // Treat 'unknown' as a candidate so a freshly-added server can still be tried before
    // its first health probe completes.
    candidates = all.filter((s) => !s.last_health_status || s.last_health_status === 'unknown');
  }
  if (candidates.length === 0) {
    throw new NoInferenceServerError('All configured inference servers are offline.');
  }

  if (options.requireModel) {
    const serverIds = new Set(await serverModelsService.serversWithModel(options.requireModel));
    const filtered = candidates.filter((s) => serverIds.has(s.id));
    if (filtered.length === 0) {
      throw new NoInferenceServerError(`Model "${options.requireModel}" is not installed on any online server.`);
    }
    candidates = filtered;
  }

  candidates.sort((a, b) => {
    const aLoad = inFlight.get(a.id) ?? 0;
    const bLoad = inFlight.get(b.id) ?? 0;
    if (aLoad !== bLoad) {
      return aLoad - bLoad;
    }
    return b.priority - a.priority;
  });

  const winner = candidates[0];
  if (!winner) {
    throw new NoInferenceServerError();
  }
  return winner;
}

export async function pickServerUrl(options: PickOptions = {}): Promise<string> {
  const server = await pickServer(options);
  return server.url;
}

/** Wrap a server-bound call so we count it in the in-flight tracker.
 *  The router uses this counter to balance load across servers. */
export async function withServer<T>(server: InferenceServer, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  inFlight.set(server.id, (inFlight.get(server.id) ?? 0) + 1);
  try {
    return await fn(server.url);
  } finally {
    inFlight.set(server.id, Math.max(0, (inFlight.get(server.id) ?? 1) - 1));
  }
}
