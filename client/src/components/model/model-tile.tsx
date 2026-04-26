import type { CatalogModel, Model } from '@sirene/shared';
import { AudioLines, Cloud, Download, FileAudio, KeyRound, Loader2, Mic, Sparkles, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { downloadBlob } from '@/utils/download';
import { formatFileSize } from '@/utils/format';

type ModelStatus = 'available' | 'pulling' | 'installed' | 'error';

interface Props {
  catalog: CatalogModel;
  installation?: Model;
  onPull: (id: string) => void;
}

export function ModelTile({ catalog, installation, onPull }: Props) {
  const { t } = useTranslation();
  const isApi = catalog.types.includes('api');
  const status: ModelStatus = installation?.status ?? 'available';
  const progress = installation?.progress ?? 0;
  const isCustom = catalog.repo === '';

  async function handleRemove() {
    await modelClient.remove(catalog.id);
  }

  async function handleExport() {
    try {
      const blob = await modelClient.exportPiper(catalog.id);
      downloadBlob(blob, `piper-${catalog.id}.zip`);
      toast.success(t('model.exported'));
    } catch {
      toast.error(t('model.exportFailed'));
    }
  }

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors', isApi ? 'border-accent-sky/40 bg-accent-sky/5' : status === 'installed' && 'border-accent-sage/40 bg-accent-sage/5')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-serif text-sm tracking-tight" title={catalog.name}>
            {catalog.name}
          </p>
          {isApi ? (
            <span className="inline-flex items-center gap-0.5 rounded bg-accent-sky/15 px-1 py-px text-[10px] font-medium text-accent-sky">
              <Cloud className="size-2.5" />
              {t('model.cloudApi')}
            </span>
          ) : (
            <span className="font-mono text-xs text-dim">{formatFileSize(catalog.size)}</span>
          )}
        </div>
        {!isApi && (
          <div className="flex shrink-0 gap-0.5">
            {(status === 'available' || status === 'error') && (
              <Button size="icon" variant="outline" className="size-7" onClick={() => onPull(catalog.id)}>
                <Download className="size-3.5" />
              </Button>
            )}
            {status === 'pulling' && (
              <Button size="icon" variant="outline" className="size-7" disabled>
                <Loader2 className="size-3.5 animate-spin" />
              </Button>
            )}
            {status === 'installed' && isCustom && (
              <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={handleExport}>
                <Download className="size-3.5" />
              </Button>
            )}
            {status === 'installed' && (
              <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" onClick={handleRemove}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
      {status === 'pulling' && <Progress value={progress} className="h-1" />}
      {status === 'error' && installation?.error && <p className="truncate text-xs text-destructive">{installation.error}</p>}
      <div className="flex flex-wrap items-center gap-1">
        {catalog.types.includes('preset') && (
          <span className="inline-flex items-center gap-0.5 rounded bg-accent-sky/15 px-1 py-px text-[10px] font-medium text-accent-sky">
            <AudioLines className="size-2.5" />
            {t('voice.preset')}
          </span>
        )}
        {catalog.types.includes('cloning') && (
          <span className="inline-flex items-center gap-0.5 rounded bg-accent-violet/15 px-1 py-px text-[10px] font-medium text-accent-violet">
            <Mic className="size-2.5" />
            {t('voice.cloning')}
          </span>
        )}
        {catalog.types.includes('transcription') && (
          <span className="inline-flex items-center gap-0.5 rounded bg-accent-green/15 px-1 py-px text-[10px] font-medium text-accent-green">
            <FileAudio className="size-2.5" />
            {t('model.stt')}
          </span>
        )}
        {catalog.types.includes('design') && (
          <span className="inline-flex items-center gap-0.5 rounded bg-accent-amber/15 px-1 py-px text-[10px] font-medium text-accent-amber">
            <Sparkles className="size-2.5" />
            {t('voice.voiceDesign')}
          </span>
        )}
        {catalog.gated && (
          <span className="inline-flex items-center gap-0.5 rounded bg-accent-rust/15 px-1 py-px text-[10px] font-medium text-accent-rust" title={t('model.hfTokenTooltip')}>
            <KeyRound className="size-2.5" />
            {t('model.hfToken')}
          </span>
        )}
      </div>
    </div>
  );
}
