import { queryOptions, useQuery } from '@tanstack/react-query';
import { config } from '@/lib/config';

interface SetupStatus {
  needsSetup: boolean;
}

export const SETUP_STATUS_QUERY_KEY = ['setup-status'] as const;

async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await fetch(`${config.server.url}/setup/status`);
  if (!res.ok) {
    // A backend hiccup must not trap returning users on the wizard.
    return { needsSetup: false };
  }
  return res.json() as Promise<SetupStatus>;
}

// The answer flips once, when the wizard creates the first user; the setup
// form writes that flip into the cache itself.
export const setupStatusQueryOptions = queryOptions({
  queryKey: SETUP_STATUS_QUERY_KEY,
  queryFn: fetchSetupStatus,
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});

export function useSetupStatus() {
  return useQuery(setupStatusQueryOptions);
}
