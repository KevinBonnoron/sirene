import { createFileRoute } from '@tanstack/react-router';
import { StudioPage } from '@/components/studio/studio-page';

export const Route = createFileRoute('/_app/')({
  component: RouteComponent,
});

function RouteComponent() {
  return <StudioPage />;
}
