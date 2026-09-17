import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export interface InstanceSettings {
  registration_enabled: boolean;
}

export const instanceClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    get: () => delegate.get<InstanceSettings>('/instance'),
    update: (settings: Partial<InstanceSettings>) => delegate.put<InstanceSettings>('/instance', settings),
  })),
);
