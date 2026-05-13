import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { safeRedirect } from '@/lib/safe-redirect';
import { useAuth } from '@/providers/auth-provider';

export const Route = createFileRoute('/_auth')({
  component: AuthLayoutRoute,
});

function AuthLayoutRoute() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
      // Honour the `?redirect=` parameter so the CLI device-code flow can land
      // the user back on `/cli-auth?code=...` after they sign in.
      const params = new URLSearchParams(window.location.search);
      const redirect = safeRedirect(params.get('redirect'));
      if (redirect) {
        window.location.replace(redirect);
        return;
      }
      navigate({ to: '/' });
    }
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  }

  if (user) {
    return null;
  }

  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}
