import { createFileRoute } from '@tanstack/react-router';
import { ModelDetailPage } from '@/components/model/model-detail-page';

export const Route = createFileRoute('/_app/models/$family')({
  component: RouteComponent,
});

function RouteComponent() {
  const { family } = Route.useParams();
  return <ModelDetailPage family={family} />;
}
