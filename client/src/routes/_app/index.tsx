import { createFileRoute } from '@tanstack/react-router';
import { StudioPage } from '@/components/studio/studio-page';

export const Route = createFileRoute('/_app/')({
  // The active session id lives in the URL so any global UI (sidebar, links from elsewhere)
  // can route to a specific session without piping React state through providers.
  validateSearch: (s: Record<string, unknown>) => ({
    session: typeof s.session === 'string' && s.session.length > 0 ? s.session : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <StudioPage />;
}
