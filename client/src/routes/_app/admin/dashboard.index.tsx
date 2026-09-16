import { createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '@/components/admin/dashboard-page';

export const Route = createFileRoute('/_app/admin/dashboard/')({
  component: RouteComponent,
});

function RouteComponent() {
  return <DashboardPage />;
}
