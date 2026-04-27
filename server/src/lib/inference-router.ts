import type { InferenceServer } from '@sirene/shared';
import { inferenceServerService } from '../services/inference-server.service';

export class NoInferenceServerError extends Error {
  public constructor(message = 'No inference server is available') {
    super(message);
    this.name = 'NoInferenceServerError';
  }
}

/** Pick a server for an outgoing call. Highest priority first; prefers online over unknown.
 *  Single-pick is intentional for now — parallel routing comes in a later phase. */
export async function pickServer(): Promise<InferenceServer> {
  const servers = await inferenceServerService.listEnabled();
  if (servers.length === 0) {
    throw new NoInferenceServerError('No inference server is configured. Add one from Settings.');
  }
  const online = servers.find((s) => s.last_health_status === 'online');
  if (online) {
    return online;
  }
  const unknown = servers.find((s) => !s.last_health_status || s.last_health_status === 'unknown');
  if (unknown) {
    return unknown;
  }
  throw new NoInferenceServerError('All configured inference servers are offline.');
}

export async function pickServerUrl(): Promise<string> {
  const server = await pickServer();
  return server.url;
}
