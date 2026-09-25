import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { ForcedPasswordChange } from '@/components/auth/forced-password-change';
import { WorkerBootstrap } from '@/components/auth/worker-bootstrap';
import { AppLayout } from '@/components/layout/app-layout';
import { setupStatusQueryOptions, useSetupStatus } from '@/hooks/use-setup-status';
import { useWorkerStatus } from '@/hooks/use-worker-status';
import { authMeQueryOptions, useAuth } from '@/providers/auth-provider';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQueryOptions);
    if (status.needsSetup) {
      throw redirect({ to: '/setup' });
    }
    const user = await context.queryClient.ensureQueryData(authMeQueryOptions);
    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: AppRoute,
});

function AppRoute() {
  const { user } = useAuth();
  const { data: status } = useSetupStatus();
  const worker = useWorkerStatus();
  // In place of the app rather than on a route of its own: no navigation goes around it.
  if (user?.mustChangePassword) {
    return <ForcedPasswordChange />;
  }
  if (status?.desktop && worker?.stage !== 'ready') {
    return <WorkerBootstrap state={worker} />;
  }
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
