import { createFileRoute } from '@tanstack/react-router';
import { HistoryPage } from '@/components/history/history-page';

export const Route = createFileRoute('/history')({
  component: RouteComponent,
});

function RouteComponent() {
  return <HistoryPage />;
}
