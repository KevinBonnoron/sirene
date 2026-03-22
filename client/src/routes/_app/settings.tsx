import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '@/components/user/setting-page';

export const Route = createFileRoute('/_app/settings')({
  component: RouteComponent,
});

function RouteComponent() {
  return <SettingsPage />;
}
