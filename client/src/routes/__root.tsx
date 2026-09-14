import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider } from '@/providers/theme-provider';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootRoute,
});

function RootRoute() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider storageKey="sirene-theme">
        <AuthProvider>
          <TooltipProvider>
            <Outlet />
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
