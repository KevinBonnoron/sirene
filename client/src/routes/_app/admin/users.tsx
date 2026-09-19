import { createFileRoute } from '@tanstack/react-router';
import { UsersPage } from '@/components/admin/users-page';

export const Route = createFileRoute('/_app/admin/users')({
  component: UsersPage,
});
