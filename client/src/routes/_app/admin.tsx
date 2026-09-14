import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { authMeQueryOptions } from '@/providers/auth-provider';

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(authMeQueryOptions);
    if (user?.role !== 'admin') {
      throw redirect({ to: '/', replace: true });
    }
  },
  component: Outlet,
});
