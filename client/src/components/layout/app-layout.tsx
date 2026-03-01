import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider className="!h-svh">
      <AppSidebar />
      <SidebarInset>
        <main className="flex min-h-0 flex-1 flex-col overflow-auto p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
