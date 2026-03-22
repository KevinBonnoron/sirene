import { createFileRoute } from '@tanstack/react-router';
import { RegisterForm } from '@/components/auth/register-form';

export const Route = createFileRoute('/_auth/register')({
  component: RouteComponent,
});

function RouteComponent() {
  return <RegisterForm />;
}
