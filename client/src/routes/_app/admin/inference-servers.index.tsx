import { createFileRoute } from '@tanstack/react-router';
import { InferenceServersPage } from '@/components/admin/inference-servers-page';

export const Route = createFileRoute('/_app/admin/inference-servers/')({
  component: RouteComponent,
});

function RouteComponent() {
  return <InferenceServersPage />;
}
