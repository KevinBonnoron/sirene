import { useEffect, useState } from 'react';
import type { ServerStats, StatsSample, WorkerLogLine } from '@/clients/inference-stats.client';
import { openAuthenticatedStream } from '@/lib/auth-stream';
import { config } from '@/lib/config';

const MAX_LOG_LINES = 1000;
const MAX_SAMPLES = 6 * 60 * 12;

export interface ServerEventsFeed {
  snapshot?: ServerStats;
  samples: StatsSample[];
  lines: WorkerLogLine[];
  status: 'connecting' | 'live' | 'unsupported' | 'error';
}

export const EMPTY_FEED: ServerEventsFeed = { samples: [], lines: [], status: 'connecting' };

// A malformed frame is dropped rather than tearing the whole stream down.
function reduce(feed: ServerEventsFeed, event: string, data: string): ServerEventsFeed {
  try {
    return apply(feed, event, data);
  } catch {
    return feed;
  }
}

function apply(feed: ServerEventsFeed, event: string, data: string): ServerEventsFeed {
  switch (event) {
    case 'sample': {
      const sample = JSON.parse(data) as StatsSample;
      return { ...feed, status: 'live', snapshot: feed.snapshot && applySample(feed.snapshot, sample), samples: [...feed.samples, sample].slice(-MAX_SAMPLES) };
    }
    case 'log':
      return { ...feed, lines: [...feed.lines, JSON.parse(data) as WorkerLogLine].slice(-MAX_LOG_LINES) };
    case 'stats':
      return { ...feed, status: 'live', snapshot: JSON.parse(data) as ServerStats };
    case 'unsupported':
      return { ...feed, status: 'unsupported' };
    case 'error':
      return feed.status === 'unsupported' ? feed : { ...feed, status: 'error' };
    default:
      return feed;
  }
}

export function useServerEvents(serverId: string, enabled: boolean): ServerEventsFeed {
  const [feed, setFeed] = useState<ServerEventsFeed>(EMPTY_FEED);

  useEffect(() => {
    setFeed(EMPTY_FEED);
    if (!enabled) {
      return;
    }
    const stream = openAuthenticatedStream(
      `${config.server.url}/inference-servers/${encodeURIComponent(serverId)}/events`,
      ({ event, data }) => setFeed((f) => reduce(f, event, data)),
      () => setFeed((f) => reduce(f, 'error', '')),
    );
    return () => stream.close();
  }, [serverId, enabled]);

  return feed;
}

// One connection for the whole list page: the API multiplexes every worker's stream and tags each event with its server.
export function useFleetEvents(serverIds: string[]): Record<string, ServerEventsFeed> {
  const [feeds, setFeeds] = useState<Record<string, ServerEventsFeed>>({});
  const key = serverIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    // The stream reopens whenever the fleet changes; servers still listed keep their gauges instead of flashing skeletons.
    setFeeds((prev) => Object.fromEntries(ids.map((id) => [id, prev[id] ?? EMPTY_FEED])));
    if (!key) {
      return;
    }
    const stream = openAuthenticatedStream(
      `${config.server.url}/inference-servers/events`,
      ({ event, data }) => {
        let frame: { server: string; data: unknown };
        try {
          frame = JSON.parse(data);
        } catch {
          return;
        }
        setFeeds((all) => ({ ...all, [frame.server]: reduce(all[frame.server] ?? EMPTY_FEED, event, JSON.stringify(frame.data)) }));
      },
      () => setFeeds((all) => Object.fromEntries(ids.map((id) => [id, reduce(all[id] ?? EMPTY_FEED, 'error', '')]))),
    );
    return () => stream.close();
  }, [key]);

  return feeds;
}

function applySample(snapshot: ServerStats, sample: StatsSample): ServerStats {
  const [gpu, ...rest] = snapshot.gpus;
  return {
    ...snapshot,
    cpu: { ...snapshot.cpu, percent: sample.cpu },
    memory: { ...snapshot.memory, used: sample.memory },
    gpus: gpu && sample.gpu !== null && sample.vram !== null ? [{ ...gpu, utilization: sample.gpu, memoryUsed: sample.vram }, ...rest] : snapshot.gpus,
  };
}
