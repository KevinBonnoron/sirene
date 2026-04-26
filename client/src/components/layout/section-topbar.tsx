import type { ReactNode } from 'react';

interface Props {
  label: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function SectionTopbar({ label, subtitle, actions }: Props) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle bg-background/70 px-3 backdrop-blur-sm sm:gap-3 sm:px-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="font-serif text-sm tracking-tight text-foreground">{label}</span>
        {subtitle && <span className="hidden truncate text-xs text-muted-foreground md:inline">{subtitle}</span>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
