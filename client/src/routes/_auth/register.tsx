import { createFileRoute } from '@tanstack/react-router';
import { RegisterForm } from '@/components/auth/register-form';

export const Route = createFileRoute('/_auth/register')({
  validateSearch: (s: Record<string, unknown>): { invite?: string } => (typeof s.invite === 'string' && s.invite !== '' ? { invite: s.invite } : {}),
  component: RouteComponent,
});

function RouteComponent() {
  const { invite } = Route.useSearch();
  return <RegisterForm invitation={invite} />;
}
