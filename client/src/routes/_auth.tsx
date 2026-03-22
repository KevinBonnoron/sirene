import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { useAuth } from '@/providers/auth-provider';

export const Route = createFileRoute('/_auth')({
  component: AuthLayoutRoute,
});

function AuthLayoutRoute() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
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
