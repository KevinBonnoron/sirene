import type { CatalogModel, InferenceServer, Model } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Download, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { inferenceServerCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { acceptsModel } from '@/lib/fleet';
import { downloadBlob } from '@/utils/download';

export type ModelStatus = 'available' | 'pulling' | 'installed' | 'error';

function isOnline(s: InferenceServer): boolean {
  return s.lastHealth.status === 'online';
}

function hasGpu(s: InferenceServer): boolean {
  return s.lastHealth.device !== undefined && s.lastHealth.device !== '' && s.lastHealth.device !== 'cpu';
}

export function useServerFleet() {
  const { data: all } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }));
  const servers = all ?? [];
  const enabledServers = servers.filter((s) => s.enabled);
  const online = enabledServers.filter(isOnline);
  const gpuServers = online.filter(hasGpu);
  return {
    servers,
    enabledServers,
    online,
    hasOnlineServer: online.length > 0,
    gpuAvailable: gpuServers.length > 0,
    targetsFor(catalog: CatalogModel): InferenceServer[] {
      return online.filter((s) => acceptsModel(s, catalog));
    },
  };
}

interface Props {
  catalog: CatalogModel;
  installation?: Model;
  onPull: (id: string, serverIds?: string[]) => void;
}

export function ModelActions({ catalog, installation, onPull }: Props) {
  const { t } = useTranslation();
  const { targetsFor, servers } = useServerFleet();
  const targets = targetsFor(catalog);
  const targetNames = targets.map((s) => s.name).join(', ');
  const status: ModelStatus = installation?.status ?? 'available';
  const isCustom = catalog.repo === '';
  const [confirmRemove, setConfirmRemove] = useState(false);
  const installedOn = (installation?.serverIds ?? []).map((id) => servers.find((s) => s.id === id)?.name).filter((n): n is string => !!n);

  async function handleRemove() {
    try {
      await modelClient.remove(catalog.id);
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

  const showInstall = (status === 'available' || status === 'error') && !isCustom;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {status === 'installed' && isCustom && (
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={handleExport} aria-label={t('common.download')}>
          <Download className="size-3.5" />
        </Button>
      )}
      {showInstall &&
        (targets.length > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="size-7"
                onClick={() =>
                  onPull(
                    catalog.id,
                    targets.map((s) => s.id),
                  )
                }
                aria-label={t('model.installOn', { servers: targetNames })}
              >
                <Download className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('model.installOn', { servers: targetNames })}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="outline" className="size-7 opacity-50" aria-disabled aria-label={t('model.noAcceptingServer')} onClick={(e) => e.preventDefault()}>
                <Download className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('model.noAcceptingServer')}</TooltipContent>
          </Tooltip>
        ))}
      {status === 'pulling' && (
        <Button size="icon" variant="outline" className="size-7" disabled aria-label={t('model.actionInstalling')}>
          <Loader2 className="size-3.5 animate-spin" />
        </Button>
      )}
      {status === 'installed' && (
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => setConfirmRemove(true)} aria-label={t('model.actionRemove')}>
          <Trash2 className="size-3.5" />
        </Button>
      )}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('model.removeConfirmTitle', { name: catalog.name })}</AlertDialogTitle>
            <AlertDialogDescription>{installedOn.length > 1 ? t('model.removeConfirmServers', { names: installedOn.join(', ') }) : t('model.removeConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRemove(false);
                handleRemove();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('model.actionRemove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
