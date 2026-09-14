import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/app-layout';
import { setupStatusQueryOptions } from '@/hooks/use-setup-status';
import { authMeQueryOptions } from '@/providers/auth-provider';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQueryOptions);
    if (status.needsSetup) {
      throw redirect({ to: '/setup' });
    }
    const user = await context.queryClient.ensureQueryData(authMeQueryOptions);
    if (!user) {
      // Preserve the destination so /login can bounce back after auth (the
      // CLI device-code flow lands on /cli-auth?code=...).
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});
