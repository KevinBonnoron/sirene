import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useIsDesktop, useIsMobile } from '@/hooks/use-mobile';
import { AppSidebar } from './app-sidebar';
import { BottomNav } from './bottom-nav';
import { GenerationBar } from './generation-bar';

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();

  return (
    <SidebarProvider className="!h-svh" open={!isMobile && isDesktop} onOpenChange={() => {}}>
      {!isMobile && <AppSidebar />}
      <SidebarInset className="relative overflow-hidden">
        <main className="absolute inset-0 overflow-x-hidden overflow-y-auto">
          <div className={`p-6 ${isMobile ? 'pb-64' : 'pb-48'}`}>{children}</div>
          <div className="sticky bottom-0 -mt-16 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </main>
        <div className={`absolute left-0 right-0 z-10 pointer-events-none ${isMobile ? 'bottom-14' : 'bottom-0'}`}>
          <div className="pointer-events-auto">
            <GenerationBar />
          </div>
        </div>
        {isMobile && (
          <div className="absolute bottom-0 left-0 right-0 z-20">
            <BottomNav />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
