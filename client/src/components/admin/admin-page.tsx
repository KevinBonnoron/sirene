import type { ReactNode } from 'react';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { useIsMobile } from '@/hooks/use-mobile';

export function AdminPage({ label, children }: { label: string; children: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div className="flex h-full flex-col">
      <SectionTopbar label={label} />
      <main className={`custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6 ${isMobile ? 'pb-24' : ''}`}>{children}</main>
    </div>
  );
}
