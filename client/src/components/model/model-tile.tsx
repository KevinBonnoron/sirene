import type { CatalogModel, InferenceServer, Model } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { AudioLines, Cloud, Download, FileAudio, KeyRound, Loader2, Mic, Server, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { inferenceServerCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useJobs } from '@/hooks/use-jobs';
import { cn } from '@/lib/utils';
import { downloadBlob } from '@/utils/download';
import { formatFileSize } from '@/utils/format';

type ModelStatus = 'available' | 'pulling' | 'installed' | 'error';

interface Props {
  catalog: CatalogModel;
  installation?: Model;
  onPull: (id: string, serverIds?: string[]) => void;
}

const STATUS_DOT: Record<'online' | 'offline' | 'unknown' | '', string> = {
  online: 'bg-accent-sage',
  offline: 'bg-destructive',
  unknown: 'bg-muted-foreground/40',
  '': 'bg-muted-foreground/40',
};

export function ModelTile({ catalog, installation, onPull }: Props) {
  const { t } = useTranslation();
  const isApi = catalog.types.includes('api');
  const status: ModelStatus = installation?.status ?? 'available';
  const progress = installation?.progress ?? 0;
  const isCustom = catalog.repo === '';
  const { data: servers } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }).where(({ s }) => s.enabled));
  const enabledServers = servers ?? [];
  const installedServerIds = installation?.serverIds ?? [];
  const isMultiServer = !isApi && enabledServers.length > 1;
  const showCoverage = !isApi && status === 'installed' && enabledServers.length > 1 && installedServerIds.length < enabledServers.length;
  const installedNames = installedServerIds.map((id) => enabledServers.find((s) => s.id === id)?.name).filter((n): n is string => !!n);

  async function handleRemove(serverId?: string) {
    try {
      await modelClient.remove(catalog.id, serverId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('model.removeFailed'));
    }
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
            {status === 'installed' && isCustom && (
              <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={handleExport} aria-label={t('common.download')}>
                <Download className="size-3.5" />
              </Button>
            )}
            {isMultiServer ? <PerServerMenu catalog={catalog} isCustom={isCustom} servers={enabledServers} installedServerIds={installedServerIds} onPull={onPull} onRemove={handleRemove} /> : <SingleServerActions status={status} isCustom={isCustom} onPull={() => onPull(catalog.id)} onRemove={() => handleRemove()} />}
          </div>
        )}
      </div>
      {status === 'pulling' && <Progress value={progress} className="h-1" />}
      {status === 'error' && installation?.error && <p className="truncate text-xs text-destructive">{installation.error}</p>}
      {showCoverage && (
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground" title={installedNames.join(', ')}>
          <Server className="size-2.5" />
          {t('model.installedOn', { count: installedServerIds.length, total: enabledServers.length })}
        </p>
      )}
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

function SingleServerActions({ status, isCustom, onPull, onRemove }: { status: ModelStatus; isCustom: boolean; onPull: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      {(status === 'available' || status === 'error') && !isCustom && (
        <Button size="icon" variant="outline" className="size-7" onClick={onPull} aria-label={t('model.actionInstall')}>
          <Download className="size-3.5" />
        </Button>
      )}
      {status === 'pulling' && (
        <Button size="icon" variant="outline" className="size-7" disabled aria-label={t('model.actionInstalling')}>
          <Loader2 className="size-3.5 animate-spin" />
        </Button>
      )}
      {status === 'installed' && (
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={t('model.actionRemove')}>
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </>
  );
}

function PerServerMenu({ catalog, isCustom, servers, installedServerIds, onPull, onRemove }: { catalog: CatalogModel; isCustom: boolean; servers: InferenceServer[]; installedServerIds: string[]; onPull: (id: string, serverIds?: string[]) => void; onRemove: (serverId?: string) => void }) {
  const { t } = useTranslation();
  const { jobs } = useJobs();
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
  const installedSet = new Set(installedServerIds);

  const pullingByServer = new Set(
    jobs
      .filter((j) => j.type === 'model_pull' && j.status === 'running' && j.target?.startsWith(`${catalog.id}::`))
      .map((j) => j.target?.split('::')[1])
      .filter((id): id is string => !!id),
  );

  // Custom (uploaded) models can't be transferred — only show servers where they actually live.
  const visibleServers = isCustom ? servers.filter((s) => installedSet.has(s.id)) : servers;
  const missingOnline = isCustom ? [] : servers.filter((s) => !installedSet.has(s.id) && s.last_health_status === 'online' && !pullingByServer.has(s.id));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="outline" className="size-7" aria-label={t('model.manage')}>
            <Server className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('model.perServer')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visibleServers.map((server) => {
            const isInstalled = installedSet.has(server.id);
            const isPulling = pullingByServer.has(server.id);
            const isOffline = server.last_health_status === 'offline';
            const disabled = isPulling || (isOffline && !isInstalled);
            const ActionIcon = isPulling ? Loader2 : isInstalled ? Trash2 : Download;
            const actionLabel = isPulling ? t('model.actionInstalling') : isInstalled ? t('model.actionRemoveFromServer', { name: server.name }) : t('model.actionInstallOnServer', { name: server.name });
            const action = () => {
              if (isInstalled) {
                onRemove(server.id);
              } else {
                onPull(catalog.id, [server.id]);
              }
            };
            return (
              <DropdownMenuItem key={server.id} disabled={disabled} onSelect={action} aria-label={actionLabel} className={cn('gap-2', isInstalled && 'data-[highlighted]:text-destructive')}>
                <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[server.last_health_status])} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{server.name}</span>
                <ActionIcon className={cn('size-3.5 shrink-0', isPulling && 'animate-spin')} aria-hidden />
              </DropdownMenuItem>
            );
          })}
          {missingOnline.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  onPull(
                    catalog.id,
                    missingOnline.map((s) => s.id),
                  );
                }}
              >
                <Download className="size-3.5" />
                {installedServerIds.length === 0 ? t('model.installOnAll', { count: missingOnline.length }) : t('model.installOnAllMissing', { count: missingOnline.length })}
              </DropdownMenuItem>
            </>
          )}
          {installedServerIds.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setConfirmRemoveAll(true)} className="data-[highlighted]:text-destructive">
                <Trash2 className="size-3.5" />
                {t('model.removeFromAll')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmRemoveAll} onOpenChange={setConfirmRemoveAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('model.removeFromAllConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('model.removeFromAllConfirmDescription', { name: catalog.name, count: installedServerIds.length })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRemoveAll(false);
                onRemove();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('model.removeFromAll')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
