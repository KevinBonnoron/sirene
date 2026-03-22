import { createFileRoute } from '@tanstack/react-router';
import { VoicesPage } from '@/components/voice/voices-page';

export const Route = createFileRoute('/_app/voices')({
  component: RouteComponent,
});

function RouteComponent() {
  return <VoicesPage />;
}
