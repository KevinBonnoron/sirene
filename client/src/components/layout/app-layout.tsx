import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { GenerationBar } from './generation-bar';

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider className="!h-svh">
      <AppSidebar />
      <SidebarInset className="relative overflow-hidden">
        <main className="absolute inset-0 overflow-x-hidden overflow-y-auto">
          <div className="p-6 pb-48">{children}</div>
          <div className="sticky bottom-0 -mt-16 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </main>
        <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
          <div className="pointer-events-auto">
            <GenerationBar />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
