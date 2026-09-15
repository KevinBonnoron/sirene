import type { CatalogModel, InferenceServer, Model } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Download, Loader2, Server, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { inferenceServerCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useJobs } from '@/hooks/use-jobs';
import { cn } from '@/lib/utils';
import { downloadBlob } from '@/utils/download';

export type ModelStatus = 'available' | 'pulling' | 'installed' | 'error';

const STATUS_DOT: Record<'online' | 'offline' | 'unknown' | '', string> = {
  online: 'bg-accent-sage',
  offline: 'bg-destructive',
  unknown: 'bg-muted-foreground/40',
  '': 'bg-muted-foreground/40',
};

export function useServerFleet() {
  const { data: servers } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }).where(({ s }) => s.enabled));
  const enabledServers = servers ?? [];
  const online = enabledServers.filter((s) => s.lastHealth.status !== 'offline');
  return {
    enabledServers,
    hasOnlineServer: online.length > 0,
    gpuAvailable: online.some((s) => s.lastHealth.device !== undefined && s.lastHealth.device !== '' && s.lastHealth.device !== 'cpu'),
  };
}

interface Props {
  catalog: CatalogModel;
  installation?: Model;
  onPull: (id: string, serverIds?: string[]) => void;
}

export function ModelActions({ catalog, installation, onPull }: Props) {
  const { t } = useTranslation();
  const { enabledServers, hasOnlineServer } = useServerFleet();
  const status: ModelStatus = installation?.status ?? 'available';
  const isCustom = catalog.repo === '';
  const installedServerIds = installation?.serverIds ?? [];

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
    <div className="flex shrink-0 items-center gap-0.5">
      {status === 'installed' && isCustom && (
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={handleExport} aria-label={t('common.download')}>
          <Download className="size-3.5" />
        </Button>
      )}
      {enabledServers.length > 1 ? (
        <PerServerMenu catalog={catalog} isCustom={isCustom} servers={enabledServers} installedServerIds={installedServerIds} onPull={onPull} onRemove={handleRemove} />
      ) : (
        <SingleServerActions status={status} isCustom={isCustom} hasOnlineServer={hasOnlineServer} onPull={() => onPull(catalog.id)} onRemove={() => handleRemove()} />
      )}
    </div>
  );
}

function SingleServerActions({ status, isCustom, hasOnlineServer, onPull, onRemove }: { status: ModelStatus; isCustom: boolean; hasOnlineServer: boolean; onPull: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const showInstall = (status === 'available' || status === 'error') && !isCustom;
  return (
    <>
      {showInstall &&
        (hasOnlineServer ? (
          <Button size="icon" variant="outline" className="size-7" onClick={onPull} aria-label={t('model.actionInstall')}>
            <Download className="size-3.5" />
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="outline" className="size-7 opacity-50" aria-disabled aria-label={t('model.actionInstallNoServer')} onClick={(e) => e.preventDefault()}>
                <Download className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('model.actionInstallNoServer')}</TooltipContent>
          </Tooltip>
        ))}
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

  const visibleServers = isCustom ? servers.filter((s) => installedSet.has(s.id)) : servers;
  const missingOnline = isCustom ? [] : servers.filter((s) => !installedSet.has(s.id) && s.lastHealth.status === 'online' && !pullingByServer.has(s.id));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="outline" className="size-7" aria-label={t('model.manage')}>
            <Server className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('model.perServer')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visibleServers.map((server) => {
            const isInstalled = installedSet.has(server.id);
            const isPulling = pullingByServer.has(server.id);
            const isOffline = server.lastHealth.status === 'offline';
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
                <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[server.lastHealth.status])} aria-hidden />
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
