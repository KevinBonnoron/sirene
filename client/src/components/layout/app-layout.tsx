import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useIsDesktop, useIsMobile } from '@/hooks/use-mobile';
import { AppSidebar } from './app-sidebar';
import { BottomNav } from './bottom-nav';

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();

  return (
    <SidebarProvider className="!h-svh" open={!isMobile && isDesktop} onOpenChange={() => {}}>
      {!isMobile && <AppSidebar />}
      <SidebarInset className="relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">{children}</div>
        {isMobile && (
          <div className="absolute bottom-0 left-0 right-0 z-20">
            <BottomNav />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
