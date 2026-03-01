import type { CatalogModel, Model } from '@sirene/shared';
import { AudioLines, Cloud, Download, FileAudio, KeyRound, Loader2, Mic, Sparkles, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { downloadBlob } from '@/lib/download';
import { formatFileSize } from '@/lib/format';
import { cn } from '@/lib/utils';

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
    <div className={cn('flex flex-col gap-2 rounded-lg border p-3', isApi ? 'border-cyan-500/40 bg-cyan-500/5' : status === 'installed' && 'border-emerald-500/40 bg-emerald-500/5')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={catalog.name}>
            {catalog.name}
          </p>
          {isApi ? (
            <span className="inline-flex items-center gap-0.5 rounded bg-cyan-500/10 px-1 py-px text-[10px] font-medium text-cyan-600 dark:text-cyan-400">
              <Cloud className="size-2.5" />
              {t('model.cloudApi')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{formatFileSize(catalog.size)}</span>
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
          <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/10 px-1 py-px text-[10px] font-medium text-blue-600 dark:text-blue-400">
            <AudioLines className="size-2.5" />
            {t('voice.preset')}
          </span>
        )}
        {catalog.types.includes('cloning') && (
          <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/10 px-1 py-px text-[10px] font-medium text-purple-600 dark:text-purple-400">
            <Mic className="size-2.5" />
            {t('voice.cloning')}
          </span>
        )}
        {catalog.types.includes('transcription') && (
          <span className="inline-flex items-center gap-0.5 rounded bg-green-500/10 px-1 py-px text-[10px] font-medium text-green-600 dark:text-green-400">
            <FileAudio className="size-2.5" />
            {t('model.stt')}
          </span>
        )}
        {catalog.types.includes('design') && (
          <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400">
            <Sparkles className="size-2.5" />
            {t('voice.voiceDesign')}
          </span>
        )}
        {catalog.gated && (
          <span className="inline-flex items-center gap-0.5 rounded bg-rose-500/10 px-1 py-px text-[10px] font-medium text-rose-600 dark:text-rose-400" title={t('model.hfTokenTooltip')}>
            <KeyRound className="size-2.5" />
            {t('model.hfToken')}
          </span>
        )}
      </div>
    </div>
  );
}
