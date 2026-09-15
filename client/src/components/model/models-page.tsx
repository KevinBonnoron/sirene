import { Box, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { AddModelDialog } from '@/components/model/add-model-dialog';
import { type Entry, type Family, FamilyRow } from '@/components/model/model-list';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModels, usePullModel } from '@/hooks/use-models';
import { cn } from '@/lib/utils';

function buildFamilies(entries: Entry[]): Family[] {
  const map = new Map<string, Family>();
  for (const entry of entries) {
    const c = entry.catalog;
    const fam = map.get(c.backend) ?? { key: c.backend, name: c.backendDisplayName, description: c.backendDescription, entries: [] };
    fam.entries.push(entry);
    map.set(c.backend, fam);
  }
  const families = [...map.values()];
  for (const fam of families) {
    fam.entries.sort((a, b) => a.catalog.name.localeCompare(b.catalog.name));
  }
  const rank = (f: Family) => (f.entries[0]?.catalog.types.includes('transcription') ? 1 : 0);
  return families.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function ModelsPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { catalog, installationsByName, isLoading } = useModels();
  const { pullModel } = usePullModel();
  const [addOpen, setAddOpen] = useState(false);

  const entries = useMemo<Entry[]>(() => catalog.map((c) => ({ catalog: c, installation: installationsByName.get(c.id) })), [catalog, installationsByName]);
  const local = useMemo(() => entries.filter((e) => e.installation && !e.catalog.types.includes('api')), [entries]);
  const cloud = useMemo(() => entries.filter((e) => e.catalog.types.includes('api')), [entries]);
  const families = useMemo(() => buildFamilies(local), [local]);

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar
        label={t('nav.models')}
        subtitle={t('model.subtitle')}
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            {t('model.add.title')}
          </Button>
        }
      />
      <main className={cn('custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6', isMobile && 'pb-24')}>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : local.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              <Box className="size-6 text-muted-foreground" />
            </div>
            <div>
              <h2 className="font-serif text-lg tracking-tight">{t('model.empty.title')}</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('model.empty.description')}</p>
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              {t('model.add.title')}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {families.map((family) => (
              <FamilyRow key={family.key} family={family} onPull={pullModel} defaultOpen />
            ))}
          </div>
        )}
        {!isLoading && cloud.length > 0 && (
          <section className="space-y-2">
            <h2 className="px-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('model.cloudSection')}</h2>
            <div className="divide-y divide-border rounded-lg border border-border bg-card">
              {buildFamilies(cloud).map((family) => (
                <FamilyRow key={family.key} family={family} onPull={pullModel} />
              ))}
            </div>
          </section>
        )}
      </main>
      <AddModelDialog entries={entries} onPull={pullModel} open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
