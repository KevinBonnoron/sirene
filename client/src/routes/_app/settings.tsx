import { createFileRoute } from '@tanstack/react-router';
import { SETTINGS_TABS, SettingsPage, type SettingsTab } from '@/components/user/setting-page';

export const Route = createFileRoute('/_app/settings')({
  // Active tab lives in the URL so deep links / back-button preserve the
  // user's place. Unknown values fall back to the first tab silently.
  validateSearch: (s: Record<string, unknown>): { tab?: SettingsTab } => {
    const value = s.tab;
    if (typeof value === 'string' && (SETTINGS_TABS as readonly string[]).includes(value)) {
      return { tab: value as SettingsTab };
    }
    return {};
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <SettingsPage />;
}
