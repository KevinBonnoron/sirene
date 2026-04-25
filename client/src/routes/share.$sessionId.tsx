import { createFileRoute } from '@tanstack/react-router';
import { PublicSessionPage } from '@/components/share/public-session-page';

export const Route = createFileRoute('/share/$sessionId')({
  component: RouteComponent,
});

function RouteComponent() {
  const { sessionId } = Route.useParams();
  return <PublicSessionPage sessionId={sessionId} />;
}
