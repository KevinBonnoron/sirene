import type { CatalogModel } from '@sirene/shared';
import { AudioLines, ChevronLeft, Download, FileAudio, Loader2, type LucideIcon, Mic, Search, Sparkles, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { languageName } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/format';
import { useServerFleet } from './model-actions';
import { type Entry, Facts } from './model-list';
import { PiperImportForm } from './piper-import-form';

type Purpose = 'preset' | 'cloning' | 'design' | 'transcription' | 'import';
const PURPOSES: { key: Purpose; icon: LucideIcon }[] = [
  { key: 'preset', icon: AudioLines },
  { key: 'cloning', icon: Mic },
  { key: 'design', icon: Sparkles },
  { key: 'transcription', icon: FileAudio },
  { key: 'import', icon: Upload },
];
const SHORTLIST = 3;
const PIPER_PREFIX = /^Piper\s+[A-Z]{2}(-[A-Z]{2})?\s+/;

function fits(c: CatalogModel, gpuAvailable: boolean): boolean {
  return gpuAvailable || c.hardware !== 'gpu';
}

function Candidate({ entry, gpuAvailable, hasOnlineServer, onPull }: { entry: Entry; gpuAvailable: boolean; hasOnlineServer: boolean; onPull: (id: string) => void }) {
  const { t } = useTranslation();
  const { catalog, installation } = entry;
  const status = installation?.status;
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{catalog.name}</span>
          {catalog.recommended && <span className="rounded bg-primary/15 px-1 py-px text-2xs font-medium text-primary">{t('model.recommended')}</span>}
          <span className="font-mono text-2xs text-dim">{formatFileSize(catalog.size)}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{catalog.description}</p>
        <div className="mt-1.5">
          <Facts entries={[entry]} gpuAvailable={gpuAvailable} />
        </div>
      </div>
      {status === 'installed' ? (
        <span className="text-2xs font-medium text-accent-sage">{t('model.status_installed')}</span>
      ) : status === 'pulling' ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <Button size="sm" variant="outline" disabled={!hasOnlineServer} onClick={() => onPull(catalog.id)}>
          <Download className="size-3.5" />
          {t('model.piper.install')}
        </Button>
      )}
    </div>
  );
}

function PiperCandidate({ entries, hasOnlineServer, onPull }: { entries: Entry[]; hasOnlineServer: boolean; onPull: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const sample = entries[0]?.catalog;
  const voices = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .map((e) => ({ entry: e, language: languageName(e.catalog.languages?.[0] ?? '', i18n.language), voice: e.catalog.name.replace(PIPER_PREFIX, '') }))
      .filter((v) => !q || `${v.language} ${v.voice}`.toLowerCase().includes(q))
      .sort((a, b) => a.language.localeCompare(b.language, i18n.language) || a.voice.localeCompare(b.voice));
  }, [entries, query, i18n.language]);
  if (!sample) {
    return null;
  }
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Piper</span>
        <span className="font-mono text-2xs text-dim">{t('model.piper.perVoice', { size: formatFileSize(sample.size) })}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{sample.backendDescription}</p>
      <div className="mt-1.5">
        <Facts entries={entries} gpuAvailable />
      </div>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('model.piper.filter')} className="h-8 pl-8 text-xs" aria-label={t('model.piper.filter')} />
      </div>
      <ul className="custom-scrollbar mt-2 max-h-56 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
        {voices.map(({ entry, language, voice }) => (
          <li key={entry.catalog.id} className="flex items-center gap-3 py-1.5 pl-3 pr-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted-foreground">{language}</span> · {voice}
            </span>
            {entry.installation?.status === 'pulling' ? (
              <Loader2 className="mr-2 size-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Button size="sm" variant="ghost" className="h-7" disabled={!hasOnlineServer} onClick={() => onPull(entry.catalog.id)}>
                <Download className="size-3.5" />
                {t('model.piper.install')}
              </Button>
            )}
          </li>
        ))}
        {voices.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">{t('model.noMatch')}</li>}
      </ul>
    </div>
  );
}

export function AddModelDialog({ entries, onPull, open, onOpenChange }: { entries: Entry[]; onPull: (id: string) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { gpuAvailable, hasOnlineServer } = useServerFleet();
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [showAll, setShowAll] = useState(false);

  const candidates = useMemo(() => {
    if (!purpose || purpose === 'import') {
      return [];
    }
    const score = (e: Entry) => (e.catalog.recommended && fits(e.catalog, gpuAvailable) ? 0 : e.catalog.recommended ? 1 : fits(e.catalog, gpuAvailable) ? 2 : 3);
    return entries.filter((e) => e.catalog.types.includes(purpose) && !e.catalog.types.includes('api') && !e.catalog.legacy && e.catalog.backend !== 'piper' && e.installation?.status !== 'installed').sort((a, b) => score(a) - score(b) || a.catalog.size - b.catalog.size);
  }, [entries, purpose, gpuAvailable]);
  const piper = purpose === 'preset' ? entries.filter((e) => e.catalog.backend === 'piper' && e.installation?.status !== 'installed') : [];
  const shown = showAll ? candidates : candidates.slice(0, SHORTLIST);
  const hidden = candidates.length - shown.length;

  function reset(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setPurpose(null);
      setShowAll(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl sm:grid-cols-[minmax(0,1fr)]">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2">
            {purpose && (
              <Button size="icon" variant="ghost" className="-ml-2 size-7" onClick={() => setPurpose(null)} aria-label={t('common.back')}>
                <ChevronLeft className="size-4" />
              </Button>
            )}
            {purpose ? t(`model.add.purposes.${purpose}`) : t('model.add.title')}
          </DialogTitle>
          <DialogDescription>{purpose === 'import' ? t('model.importPiperDescription') : purpose ? (gpuAvailable ? t('model.add.withGpu') : t('model.add.withoutGpu')) : t('model.add.question')}</DialogDescription>
        </DialogHeader>

        {!purpose ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {PURPOSES.map(({ key, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setPurpose(key)} className={cn('flex items-start gap-3 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5')}>
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(`model.add.purposes.${key}`)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t(`model.add.hints.${key}`)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : purpose === 'import' ? (
          <PiperImportForm onDone={() => reset(false)} />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {shown.map((entry) => (
              <Candidate key={entry.catalog.id} entry={entry} gpuAvailable={gpuAvailable} hasOnlineServer={hasOnlineServer} onPull={onPull} />
            ))}
            {piper.length > 0 && <PiperCandidate entries={piper} hasOnlineServer={hasOnlineServer} onPull={onPull} />}
            {hidden > 0 && (
              <button type="button" onClick={() => setShowAll(true)} className="w-full px-4 py-2.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                {t('model.add.showMore', { count: hidden })}
              </button>
            )}
            {shown.length === 0 && piper.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('model.noMatch')}</p>}
          </div>
        )}
        {!hasOnlineServer && purpose !== 'import' && <p className="text-xs text-accent-rust">{t('model.actionInstallNoServer')}</p>}
      </DialogContent>
    </Dialog>
  );
}
