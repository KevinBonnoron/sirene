import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthLayout } from '@/components/auth/auth-layout';
import { SetupForm } from '@/components/auth/setup-form';
import { setupStatusQueryOptions } from '@/hooks/use-setup-status';

export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQueryOptions);
    if (!status.needsSetup) {
      throw redirect({ to: '/login' });
    }
  },
  component: () => (
    <AuthLayout>
      <SetupForm />
    </AuthLayout>
  ),
});
