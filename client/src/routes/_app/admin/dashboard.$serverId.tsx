import { createFileRoute } from '@tanstack/react-router';
import { ServerDetailPage } from '@/components/admin/server-detail-page';

export const Route = createFileRoute('/_app/admin/dashboard/$serverId')({
  component: RouteComponent,
});

function RouteComponent() {
  const { serverId } = Route.useParams();
  return <ServerDetailPage serverId={serverId} />;
}
