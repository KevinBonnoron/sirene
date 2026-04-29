import type { CatalogModel, CatalogModelType, Model } from '@sirene/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { ModelCard } from '@/components/model/model-card';
import { PiperImportDialog } from '@/components/model/piper-import-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModels, usePullModel } from '@/hooks/use-models';
import { cn } from '@/lib/utils';

function groupByBackend(models: CatalogModel[], installations: Map<string, Model>) {
  const groups = new Map<string, { catalog: CatalogModel; installation?: Model }[]>();
  for (const c of models) {
    const list = groups.get(c.backend) ?? [];
    list.push({ catalog: c, installation: installations.get(c.id) });
    groups.set(c.backend, list);
  }
  return groups;
}

const chipBase = 'rounded-full border px-3 py-1 text-xs font-medium transition-colors';
const chipDefault = 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground';

type FilterKey = CatalogModelType | 'gated';

const filterConfig: Record<FilterKey, { label: string; active: string }> = {
  preset: { label: 'voice.preset', active: 'border-accent-sky/60 bg-accent-sky/15 text-accent-sky' },
  cloning: { label: 'voice.cloning', active: 'border-accent-violet/60 bg-accent-violet/15 text-accent-violet' },
  design: { label: 'voice.voiceDesign', active: 'border-accent-amber/60 bg-accent-amber/15 text-accent-amber' },
  api: { label: 'voice.cloud', active: 'border-accent-sky/60 bg-accent-sky/15 text-accent-sky' },
  transcription: { label: 'model.stt', active: 'border-accent-green/60 bg-accent-green/15 text-accent-green' },
  gated: { label: 'model.hfToken', active: 'border-accent-rust/60 bg-accent-rust/15 text-accent-rust' },
};

export function ModelsPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { catalog, installationsByName, isLoading } = useModels();
  const { pullModel } = usePullModel();

  const [filter, setFilter] = useState<FilterKey | null>(null);

  // Available model types (only those present in catalog)
  const types = useMemo(() => {
    const set = new Set(catalog.flatMap((c) => c.types));
    return (['preset', 'cloning', 'design', 'api', 'transcription'] as const).filter((t) => set.has(t));
  }, [catalog]);

  // Extra filter keys (only shown when relevant models exist)
  const extraFilters = useMemo(() => {
    const keys: FilterKey[] = [];
    if (catalog.some((c) => c.gated)) {
      keys.push('gated');
    }
    return keys;
  }, [catalog]);

  // Filter models
  const filteredModels = useMemo(() => {
    if (!filter) {
      return catalog;
    }

    if (filter === 'gated') {
      return catalog.filter((c) => c.gated);
    }

    return catalog.filter((c) => c.types.includes(filter));
  }, [catalog, filter]);

  const groups = groupByBackend(filteredModels, installationsByName);

  // Check if piper backend exists
  const hasPiper = catalog.some((c) => c.backend === 'piper');

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar label={t('nav.models')} subtitle={t('model.subtitle')} actions={hasPiper ? <PiperImportDialog /> : undefined} />
      <main className={`custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6 ${isMobile ? 'pb-24' : ''}`}>
        {isLoading ? (
          <div className="grid gap-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <>
            {/* Filter chips */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setFilter(null)} className={cn(chipBase, !filter ? 'border-primary bg-primary text-primary-foreground' : chipDefault)}>
                {t('voice.all')}
              </button>
              {types.map((value) => {
                const cfg = filterConfig[value];
                return (
                  <button key={value} type="button" onClick={() => setFilter(filter === value ? null : value)} className={cn(chipBase, filter === value ? cfg.active : chipDefault)}>
                    {t(cfg.label)}
                  </button>
                );
              })}
              {extraFilters.map((key) => {
                const cfg = filterConfig[key];
                return (
                  <button key={key} type="button" onClick={() => setFilter(filter === key ? null : key)} className={cn(chipBase, filter === key ? cfg.active : chipDefault)}>
                    {t(cfg.label)}
                  </button>
                );
              })}
            </div>

            {/* Backend groups */}
            <div className="space-y-4">
              {[...groups.entries()].map(([backend, models]) => (
                <ModelCard key={backend} backend={backend} description={models[0]?.catalog.backendDescription ?? ''} models={models} onPull={pullModel} />
              ))}
              {groups.size === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t('model.noMatch')}</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
