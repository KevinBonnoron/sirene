import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { ForcedPasswordChange } from '@/components/auth/forced-password-change';
import { AppLayout } from '@/components/layout/app-layout';
import { setupStatusQueryOptions } from '@/hooks/use-setup-status';
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
  // In place of the app rather than on a route of its own: no navigation goes around it.
  if (user?.mustChangePassword) {
    return <ForcedPasswordChange />;
  }
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
