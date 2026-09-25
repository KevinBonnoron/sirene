import { queryOptions, useQuery } from '@tanstack/react-query';
import { config } from '@/lib/config';

interface SetupStatus {
  needsSetup: boolean;
  registrationEnabled: boolean;
  desktop: boolean;
}

export const SETUP_STATUS_QUERY_KEY = ['setup-status'] as const;

async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await fetch(`${config.server.url}/setup/status`);
  if (!res.ok) {
    return { needsSetup: false, registrationEnabled: true, desktop: false };
  }
  return res.json() as Promise<SetupStatus>;
}

export const setupStatusQueryOptions = queryOptions({
  queryKey: SETUP_STATUS_QUERY_KEY,
  queryFn: fetchSetupStatus,
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});

export function useSetupStatus() {
  return useQuery(setupStatusQueryOptions);
}
