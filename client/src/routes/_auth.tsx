import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { setupStatusQueryOptions } from '@/hooks/use-setup-status';
import { safeRedirect } from '@/lib/safe-redirect';
import { authMeQueryOptions, useAuth } from '@/providers/auth-provider';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQueryOptions);
    if (status.needsSetup) {
      throw redirect({ to: '/setup' });
    }
    const user = await context.queryClient.ensureQueryData(authMeQueryOptions);
    if (user && !safeRedirect(new URLSearchParams(location.searchStr).get('redirect'))) {
      throw redirect({ to: '/' });
    }
  },
  component: AuthLayoutRoute,
});

function AuthLayoutRoute() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      return;
    }
    const redirectTo = safeRedirect(new URLSearchParams(window.location.search).get('redirect'));
    if (redirectTo) {
      window.location.replace(redirectTo);
      return;
    }
    navigate({ to: '/' });
  }, [user, navigate]);

  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}
