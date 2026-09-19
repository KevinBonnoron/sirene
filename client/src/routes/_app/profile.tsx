import { createFileRoute } from '@tanstack/react-router';
import { PROFILE_TABS, ProfilePage, type ProfileTab } from '@/components/user/profile-page';

export const Route = createFileRoute('/_app/profile')({
  validateSearch: (s: Record<string, unknown>): { tab?: ProfileTab } => (PROFILE_TABS.includes(s.tab as ProfileTab) ? { tab: s.tab as ProfileTab } : {}),
  component: RouteComponent,
});

function RouteComponent() {
  const { tab } = Route.useSearch();
  return <ProfilePage tab={tab ?? 'account'} />;
}
