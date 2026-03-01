import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export interface SettingEntry {
  key: string;
  maskedValue: string;
}

export const settingsClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    getAll: () => delegate.get<SettingEntry[]>('/settings'),
    update: (key: string, value: string) => delegate.put<{ success: boolean }>('/settings', { key, value }),
    remove: (key: string) => delegate.delete<{ success: boolean }>(`/settings/${key}`),
  })),
);
