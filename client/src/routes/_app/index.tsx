import { createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '@/components/dashboard/dashboard-page';

export const Route = createFileRoute('/_app/')({
  component: RouteComponent,
});

function RouteComponent() {
  return <DashboardPage />;
}
