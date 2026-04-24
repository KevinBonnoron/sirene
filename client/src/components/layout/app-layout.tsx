import { useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useIsDesktop, useIsMobile } from '@/hooks/use-mobile';
import { AppSidebar } from './app-sidebar';
import { BottomNav } from './bottom-nav';

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  const router = useRouterState();
  const isStudio = router.location.pathname === '/';

  return (
    <SidebarProvider className="!h-svh" open={!isMobile && isDesktop} onOpenChange={() => {}}>
      {!isMobile && <AppSidebar />}
      <SidebarInset className="relative overflow-hidden">
        {isStudio ? (
          <div className="absolute inset-0 overflow-hidden">{children}</div>
        ) : (
          <main className="absolute inset-0 overflow-x-hidden overflow-y-auto">
            <div className={`p-6 ${isMobile ? 'pb-20' : ''}`}>{children}</div>
          </main>
        )}
        {isMobile && (
          <div className="absolute bottom-0 left-0 right-0 z-20">
            <BottomNav />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
