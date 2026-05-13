import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { useAuth } from '@/providers/auth-provider';

export const Route = createFileRoute('/_app')({
  component: AppLayoutRoute,
});

function AppLayoutRoute() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) {
      // Preserve where the user was heading so /login can bounce them back
      // after auth (used by the CLI device-code flow on /cli-auth).
      const target = `${window.location.pathname}${window.location.search}`;
      navigate({ to: '/login', search: { redirect: target } });
    }
  }, [user, isLoading, navigate]);

  if (!isLoading && !user) {
    return null;
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
