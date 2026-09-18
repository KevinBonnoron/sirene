import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/format';
import { ModelActions, useServerFleet } from './model-actions';
import { Facts, type Family, RecommendedStar, TypeChips } from './model-list';

export function ModelCard({ family, onPull }: { family: Family; onPull: (id: string, serverIds?: string[]) => void }) {
  const { t } = useTranslation();
  const { gpuAvailable } = useServerFleet();
  const single = family.entries.length === 1 ? family.entries[0] : undefined;
  const installed = family.entries.filter((e) => e.installation?.status === 'installed');
  const unreachable = family.entries.some((e) => e.installation?.status === 'missing');
  const types = [...new Set(family.entries.flatMap((e) => e.catalog.types))];
  const recommended = family.entries.some((e) => e.catalog.recommended);
  const pulling = single?.installation?.status === 'pulling' ? single.installation.progress : undefined;
  const size = installed.reduce((total, e) => total + e.catalog.size, 0) || family.entries[0]?.catalog.size || 0;

  return (
    <div className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border-strong">
      {pulling !== undefined && <Progress value={pulling} className="absolute inset-x-0 top-0 h-0.5 rounded-none" />}
      <Link to="/models/$family" params={{ family: family.key }} className="flex flex-1 flex-col gap-2 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-1.5">
            <h3 className="min-w-0 truncate font-serif text-base tracking-tight">{single ? single.catalog.name : family.name}</h3>
            {recommended && <RecommendedStar className="mt-1 size-3.5 shrink-0" />}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <TypeChips types={types} gated={single?.catalog.gated} />
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
          <Facts entries={family.entries} gpuAvailable={gpuAvailable} hardwareOnly />
          <span className="font-mono text-2xs text-dim">{formatFileSize(size)}</span>
        </div>
      </Link>
      <div className="flex min-h-9 items-center justify-between gap-2 border-t border-border-subtle px-4 py-1.5">
        <span className={cn('truncate text-2xs font-medium', unreachable ? 'text-destructive' : 'text-accent-sage')}>{unreachable ? t('model.status_missing') : t('model.voiceCount', { count: installed.length })}</span>
        {single && <ModelActions catalog={single.catalog} installation={single.installation} onPull={onPull} />}
      </div>
    </div>
  );
}
