import { createFileRoute } from '@tanstack/react-router';
import { CliAuthPage } from '@/components/auth/cli-auth-page';

export const Route = createFileRoute('/_app/cli-auth')({
  component: RouteComponent,
});

function RouteComponent() {
  return <CliAuthPage />;
}
