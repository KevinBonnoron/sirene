import { createFileRoute } from '@tanstack/react-router';
import { ProfilePage } from '@/components/user/profile-page';

export const Route = createFileRoute('/_app/profile')({
  component: RouteComponent,
});

function RouteComponent() {
  return <ProfilePage />;
}
