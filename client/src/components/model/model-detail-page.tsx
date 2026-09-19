import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Section } from '@/components/layout/section';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModels, usePullModel } from '@/hooks/use-models';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/format';
import { ModelActions, useServerFleet } from './model-actions';
import { type Entry, Facts, ServerCoverage, TypeChips } from './model-list';

const variantGrid = 'grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-x-4 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_5rem_2.25rem]';

function VariantList({ entries, onPull }: { entries: Entry[]; onPull: (id: string, serverIds?: string[]) => void }) {
  return (
    <div className="divide-y divide-border-subtle rounded-lg border border-border bg-card">
      {entries.map((entry) => (
        <div key={entry.catalog.id} className={variantGrid}>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{entry.catalog.name}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.catalog.description}</p>
          </div>
          <div className="hidden min-w-0 justify-end truncate sm:flex">
            <ServerCoverage catalog={entry.catalog} installation={entry.installation} onPull={onPull} />
          </div>
          <span className="hidden text-right font-mono text-xs text-dim sm:block">{formatFileSize(entry.catalog.size)}</span>
          <div className="flex justify-end">
            <ModelActions catalog={entry.catalog} installation={entry.installation} onPull={onPull} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ModelDetailPage({ family }: { family: string }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { catalog, installationsByName, isLoading } = useModels();
  const { pullModel } = usePullModel();
  const { gpuAvailable } = useServerFleet();

  const entries = useMemo<Entry[]>(
    () =>
      catalog
        .filter((c) => c.backend === family)
        .map((c) => ({ catalog: c, installation: installationsByName.get(c.id) }))
        .sort((a, b) => a.catalog.name.localeCompare(b.catalog.name)),
    [catalog, family, installationsByName],
  );
  const owned = entries.filter((e) => e.installation);
  const available = entries.filter((e) => !e.installation);
  const first = entries[0]?.catalog;

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar
        label={first?.backendDisplayName ?? family}
        subtitle={first?.backendDescription}
        actions={
          <Link to="/admin/models" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            {t('nav.models')}
          </Link>
        }
      />
      <main className={cn('custom-scrollbar flex flex-1 flex-col gap-8 overflow-y-auto p-6', isMobile && 'pb-24')}>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('model.detail.unknown')}</p>
        ) : (
          <>
            <section className="flex flex-wrap items-center gap-2">
              <TypeChips types={[...new Set(entries.flatMap((e) => e.catalog.types))]} gated={first?.gated} />
              <Facts entries={entries} gpuAvailable={gpuAvailable} />
            </section>
            {owned.length > 0 && (
              <Section title={t('model.detail.installed', { count: owned.length })} description={t('model.detail.installedHint')}>
                <VariantList entries={owned} onPull={pullModel} />
              </Section>
            )}
            {available.length > 0 && (
              <Section title={t('model.detail.available', { count: available.length })} description={t('model.detail.availableHint')}>
                <VariantList entries={available} onPull={pullModel} />
              </Section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
