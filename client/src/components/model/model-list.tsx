import type { CatalogModel, Model } from '@sirene/shared';
import { AudioLines, ChevronRight, Cpu, Download, FileAudio, Globe, KeyRound, Mic, Scale, Sparkles, Star, Trash2, Zap } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { languageName } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/format';
import { ModelActions, useServerFleet } from './model-actions';

export interface Entry {
  catalog: CatalogModel;
  installation?: Model;
}

export interface Family {
  key: string;
  name: string;
  description: string;
  entries: Entry[];
}

type CatalogModelType = CatalogModel['types'][number];

const chip = 'inline-flex items-center gap-0.5 rounded px-1 py-px text-2xs font-medium';
const grid = 'grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-x-4 px-4 sm:grid-cols-[minmax(0,1fr)_auto_5.5rem_2.25rem]';

const TYPE_CHIPS: { type: CatalogModelType; icon: typeof Mic; className: string; label: string }[] = [
  { type: 'preset', icon: AudioLines, className: 'bg-accent-sky/15 text-accent-sky', label: 'voice.preset' },
  { type: 'cloning', icon: Mic, className: 'bg-accent-violet/15 text-accent-violet', label: 'voice.cloning' },
  { type: 'design', icon: Sparkles, className: 'bg-primary/15 text-primary', label: 'voice.voiceDesign' },
  { type: 'transcription', icon: FileAudio, className: 'bg-accent-green/15 text-accent-green', label: 'model.stt' },
];

export function TypeChips({ types, gated }: { types: CatalogModelType[]; gated?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {TYPE_CHIPS.filter((c) => types.includes(c.type)).map(({ type, icon: Icon, className, label }) => (
        <span key={type} className={cn(chip, className)}>
          <Icon className="size-2.5" />
          {t(label)}
        </span>
      ))}
      {gated && (
        <span className={cn(chip, 'bg-accent-rust/15 text-accent-rust')} title={t('model.hfTokenTooltip')}>
          <KeyRound className="size-2.5" />
          {t('model.hfToken')}
        </span>
      )}
    </>
  );
}

export function Facts({ entries, gpuAvailable, columns }: { entries: Entry[]; gpuAvailable: boolean; columns?: boolean }) {
  const { t, i18n } = useTranslation();
  const first = entries[0]?.catalog;
  if (!first) {
    return null;
  }
  const languages = [...new Set(entries.flatMap((e) => e.catalog.languages ?? []))];
  const allLanguages = languages.includes('*');
  const licenses = [...new Set(entries.map((e) => e.catalog.license).filter((l): l is string => !!l))];
  const nonCommercial = entries.some((e) => e.catalog.commercial === false);
  const minVram = Math.max(...entries.map((e) => e.catalog.minVram ?? 0));

  const hardware = (
    <>
      {first.hardware === 'cpu' && (
        <span className="inline-flex items-center gap-1 text-accent-sage">
          <Cpu className="size-3" />
          {t('model.cpuFriendly')}
        </span>
      )}
      {first.hardware === 'gpu' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn('inline-flex items-center gap-1', !gpuAvailable && 'text-accent-rust')}>
              <Zap className="size-3" />
              {minVram ? t('model.gpuVram', { count: minVram }) : t('model.gpu')}
            </span>
          </TooltipTrigger>
          <TooltipContent>{gpuAvailable ? t('model.gpuRecommended') : t('model.noGpuServer')}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
  const license = licenses.length > 0 && (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex items-center gap-1', nonCommercial && 'text-accent-rust')}>
          <Scale className="size-3" />
          {nonCommercial ? t('model.nonCommercial') : licenses.join(', ')}
        </span>
      </TooltipTrigger>
      <TooltipContent>{nonCommercial ? licenses.join(', ') : t('model.commercialOk')}</TooltipContent>
    </Tooltip>
  );
  const langs = languages.length > 0 && (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1">
          <Globe className="size-3" />
          {allLanguages ? t('model.allLanguages') : languages.length === 1 ? languageName(languages[0] ?? '', i18n.language) : t('model.languageCount', { count: languages.length })}
        </span>
      </TooltipTrigger>
      {!allLanguages && languages.length > 1 && <TooltipContent className="max-w-xs">{languages.map((code) => languageName(code, i18n.language)).join(', ')}</TooltipContent>}
    </Tooltip>
  );
  if (columns) {
    return (
      <div className="grid grid-cols-[5.5rem_minmax(0,8rem)_6.5rem] items-center gap-x-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{hardware}</span>
        <span className="min-w-0 truncate">{license}</span>
        <span className="min-w-0 truncate">{langs}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {hardware}
      {license}
      {langs}
    </div>
  );
}

export function ServerCoverage({ installation }: { installation?: Model }) {
  const { t } = useTranslation();
  const { enabledServers } = useServerFleet();
  if (installation?.status !== 'installed') {
    return null;
  }
  if (enabledServers.length < 2) {
    return <span className="text-2xs font-medium text-accent-sage">{t('model.status_installed')}</span>;
  }
  const on = new Set(installation.serverIds);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {enabledServers.map((server) => {
        const installed = on.has(server.id);
        const offline = server.lastHealth.status === 'offline';
        return (
          <span
            key={server.id}
            className={cn('inline-flex items-center gap-1 rounded px-1 py-px text-2xs font-medium', installed ? 'bg-accent-sage/15 text-accent-sage' : 'bg-muted text-dim')}
            title={installed ? t('model.installedOnServer', { name: server.name }) : t('model.notInstalledOnServer', { name: server.name })}
          >
            <span className={cn('size-1.5 rounded-full', offline ? 'bg-destructive' : installed ? 'bg-accent-sage' : 'bg-muted-foreground/40')} aria-hidden />
            {server.name}
          </span>
        );
      })}
    </span>
  );
}

function commonPrefix(names: string[]): string {
  const first = names[0] ?? '';
  let end = first.length;
  for (const name of names) {
    while (end > 0 && !name.startsWith(first.slice(0, end))) {
      end--;
    }
  }
  const cut = first.slice(0, end).lastIndexOf(' ');
  return cut > 0 ? first.slice(0, cut + 1) : '';
}

export function variantName(catalog: CatalogModel, prefix: string): string {
  return prefix && catalog.name.startsWith(prefix) ? catalog.name.slice(prefix.length) : catalog.name;
}

function Row({ main, aside, size, action, className, indent, progress }: { main: ReactNode; aside?: ReactNode; size?: ReactNode; action: ReactNode; className?: string; indent?: boolean; progress?: number }) {
  return (
    <div className={cn(grid, 'relative py-2.5', indent && 'bg-background/40', className)}>
      {progress !== undefined && <Progress value={progress} className="absolute inset-x-0 bottom-0 h-0.5 rounded-none" />}
      <div className={cn('min-w-0', indent && 'pl-6')}>{main}</div>
      <div className="hidden sm:block">{aside}</div>
      <span className="hidden text-right font-mono text-xs text-dim sm:block">{size}</span>
      <div className="flex justify-end">{action}</div>
    </div>
  );
}

function VariantRow({ entry, prefix, onPull }: { entry: Entry; prefix: string; onPull: (id: string, serverIds?: string[]) => void }) {
  const { t } = useTranslation();
  const { catalog, installation } = entry;
  const status = installation?.status ?? 'available';
  return (
    <Row
      indent
      main={
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={cn('text-sm', status === 'installed' && 'font-medium')}>{variantName(catalog, prefix)}</span>
          {catalog.recommended && <Star className="size-3 text-primary" aria-label={t('model.recommended')} />}
          <ServerCoverage installation={installation} />
          <span className="font-mono text-2xs text-dim sm:hidden">{formatFileSize(catalog.size)}</span>
          {status === 'error' && installation?.error && <p className="basis-full truncate text-xs text-destructive">{installation.error}</p>}
        </div>
      }
      aside={
        <div className="flex items-center gap-1">
          <TypeChips types={catalog.types} gated={catalog.gated} />
        </div>
      }
      size={formatFileSize(catalog.size)}
      action={<ModelActions catalog={catalog} installation={installation} onPull={onPull} />}
    />
  );
}

export function FamilyRow({ family, onPull, defaultOpen }: { family: Family; onPull: (id: string, serverIds?: string[]) => void; defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const { gpuAvailable } = useServerFleet();
  const [open, setOpen] = useState(!!defaultOpen);
  const single = family.entries.length === 1 ? family.entries[0] : undefined;
  const prefix = commonPrefix(family.entries.map((e) => e.catalog.name));
  const recommended = family.entries.some((e) => e.catalog.recommended);
  const types = [...new Set(family.entries.flatMap((e) => e.catalog.types))];
  const installedCount = family.entries.filter((e) => e.installation?.status === 'installed').length;

  return (
    <div className="divide-y divide-border-subtle">
      <Row
        main={
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-base tracking-tight">{single ? single.catalog.name : family.name}</h3>
              {recommended && <Star className="size-3.5 text-primary" aria-label={t('model.recommended')} />}
              <TypeChips types={types} gated={single?.catalog.gated} />
              {single && <ServerCoverage installation={single.installation} />}
              {!single && installedCount > 0 && <span className="text-2xs font-medium text-accent-sage">{t('model.installedCount', { count: installedCount })}</span>}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{family.description}</p>
            {single?.installation?.status === 'error' && single.installation.error && <p className="mt-1 truncate text-xs text-destructive">{single.installation.error}</p>}
          </div>
        }
        aside={<Facts entries={family.entries} gpuAvailable={gpuAvailable} columns />}
        size={single ? formatFileSize(single.catalog.size) : t('model.variantCount', { count: family.entries.length })}
        progress={single?.installation?.status === 'pulling' ? single.installation.progress : undefined}
        action={
          single ? (
            <ModelActions catalog={single.catalog} installation={single.installation} onPull={onPull} />
          ) : (
            <Button size="icon" variant="ghost" className="size-7" aria-expanded={open} aria-label={t('model.expand', { name: family.name })} onClick={() => setOpen((v) => !v)}>
              <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
            </Button>
          )
        }
      />
      {!single && open && family.entries.map((entry) => <VariantRow key={entry.catalog.id} entry={entry} prefix={prefix} onPull={onPull} />)}
    </div>
  );
}

const PIPER_PREFIX = /^Piper\s+[A-Z]{2}(-[A-Z]{2})?\s+/;

export function PiperRow({ family, onPull }: { family: Family; onPull: (id: string, serverIds?: string[]) => void }) {
  const { t, i18n } = useTranslation();
  const { hasOnlineServer, gpuAvailable } = useServerFleet();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const installed = family.entries.filter((e) => e.installation && e.installation.status !== 'error');
  const available = family.entries.filter((e) => !e.installation || e.installation.status === 'error');

  const byLanguage = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const e of available) {
      const label = languageName(e.catalog.languages?.[0] ?? e.catalog.language ?? '', i18n.language);
      groups.set(label, [...(groups.get(label) ?? []), e]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, i18n.language));
  }, [available, i18n.language]);

  async function remove(id: string) {
    try {
      await modelClient.remove(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('model.removeFailed'));
    }
  }

  return (
    <div className="divide-y divide-border-subtle">
      <Row
        main={
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-base tracking-tight">{family.name}</h3>
              <TypeChips types={['preset']} />
              {installed.length > 0 && <span className="text-2xs font-medium text-accent-sage">{t('model.installedCount', { count: installed.length })}</span>}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{family.description}</p>
          </div>
        }
        aside={<Facts entries={family.entries} gpuAvailable={gpuAvailable} columns />}
        size={t('model.voiceCount', { count: family.entries.length })}
        action={
          <Button size="icon" variant="ghost" className="size-7" aria-expanded={open} aria-label={t('model.expand', { name: family.name })} onClick={() => setOpen((v) => !v)}>
            <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
          </Button>
        }
      />
      {open && (
        <Row
          indent
          main={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="h-8 w-64 text-xs" aria-label={t('model.piper.selectVoice')}>
                  <SelectValue placeholder={t('model.piper.selectVoice')} />
                </SelectTrigger>
                <SelectContent>
                  {byLanguage.map(([language, voices]) => (
                    <SelectGroup key={language}>
                      <SelectLabel>{language}</SelectLabel>
                      {voices.map(({ catalog }) => (
                        <SelectItem key={catalog.id} value={catalog.id}>
                          {language} · {catalog.name.replace(PIPER_PREFIX, '')}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={!selected || !hasOnlineServer}
                onClick={() => {
                  if (selected) {
                    onPull(selected);
                    setSelected('');
                  }
                }}
              >
                <Download className="size-3.5" />
                {t('model.piper.install')}
              </Button>
            </div>
          }
          action={null}
        />
      )}
      {open &&
        installed.map(({ catalog, installation }) => (
          <Row
            key={catalog.id}
            indent
            main={
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">
                  {languageName(catalog.languages?.[0] ?? '', i18n.language)} · {catalog.name.replace(PIPER_PREFIX, '')}
                </span>
                {installation?.status === 'pulling' ? <span className="font-mono text-2xs text-dim">{installation.progress}%</span> : <span className="text-2xs font-medium text-accent-sage">{t('model.status_installed')}</span>}
              </div>
            }
            size={formatFileSize(catalog.size)}
            progress={status === 'pulling' ? (installation?.progress ?? 0) : undefined}
            action={
              installation?.status === 'installed' && (
                <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => remove(catalog.id)} aria-label={t('model.actionRemove')}>
                  <Trash2 className="size-3.5" />
                </Button>
              )
            }
          />
        ))}
    </div>
  );
}
