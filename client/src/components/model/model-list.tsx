import type { CatalogModel, Model } from '@sirene/shared';
import { AudioLines, Cpu, Download, FileAudio, Globe, KeyRound, Mic, Scale, Sparkles, Star, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { languageName } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { useServerFleet } from './model-actions';

export interface Entry {
  catalog: CatalogModel;
  installation?: Model;
}

export interface Family {
  key: string;
  name: string;
  entries: Entry[];
}

type CatalogModelType = CatalogModel['types'][number];

const chip = 'inline-flex items-center gap-0.5 rounded px-1 py-px text-2xs font-medium';

const TYPE_CHIPS: { type: CatalogModelType; icon: typeof Mic; className: string; label: string }[] = [
  { type: 'preset', icon: AudioLines, className: 'bg-accent-sky/15 text-accent-sky', label: 'voice.preset' },
  { type: 'cloning', icon: Mic, className: 'bg-accent-violet/15 text-accent-violet', label: 'voice.cloning' },
  { type: 'design', icon: Sparkles, className: 'bg-primary/15 text-primary', label: 'voice.voiceDesign' },
  { type: 'transcription', icon: FileAudio, className: 'bg-accent-green/15 text-accent-green', label: 'model.stt' },
];

export function RecommendedStar({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Star className={cn('text-primary', className)} aria-label={t('model.recommended')} />
      </TooltipTrigger>
      <TooltipContent>{t('model.recommended')}</TooltipContent>
    </Tooltip>
  );
}

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

export function Facts({ entries, gpuAvailable, columns, hardwareOnly }: { entries: Entry[]; gpuAvailable: boolean; columns?: boolean; hardwareOnly?: boolean }) {
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
  if (hardwareOnly) {
    return <span className="min-w-0 truncate text-xs text-muted-foreground">{hardware}</span>;
  }
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

export function ServerCoverage({ catalog, installation, onPull }: { catalog: CatalogModel; installation?: Model; onPull: (id: string, serverIds?: string[]) => void }) {
  const { t } = useTranslation();
  const { targetsFor } = useServerFleet();
  if (installation?.status === 'missing') {
    return <span className="text-2xs font-medium text-destructive">{t('model.status_missing')}</span>;
  }
  if (installation?.status !== 'installed') {
    return null;
  }
  const on = new Set(installation.serverIds);
  const missing = targetsFor(catalog).filter((s) => !on.has(s.id));
  if (missing.length === 0) {
    return <span className="text-2xs font-medium text-accent-sage">{t('model.status_installed')}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs">
      <span className="text-accent-rust">{t('model.missingOn', { names: missing.map((s) => s.name).join(', ') })}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 gap-1 px-2 text-2xs"
        onClick={() =>
          onPull(
            catalog.id,
            missing.map((s) => s.id),
          )
        }
      >
        <Download className="size-3" />
        {t('model.complete')}
      </Button>
    </span>
  );
}
