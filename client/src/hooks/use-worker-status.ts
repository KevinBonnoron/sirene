import { useSyncExternalStore } from 'react';
import { subscribeToAppEvents } from '@/lib/app-events';

export interface WorkerState {
  stage: 'pending' | 'python' | 'dependencies' | 'starting' | 'ready' | 'failed';
  detail?: string;
  error?: string;
  logFile?: string;
}

// Module-level: the state is sent once per connection, and a remount can join an open stream.
let latest: WorkerState | undefined;
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribe) {
    unsubscribe = subscribeToAppEvents(({ event, data }) => {
      if (event !== 'worker') {
        return;
      }
      latest = JSON.parse(data) as WorkerState;
      for (const notify of listeners) {
        notify();
      }
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

const snapshot = () => latest;

/** Undefined outside the desktop app, where no worker is installed by the server's own process. */
export function useWorkerStatus(): WorkerState | undefined {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
