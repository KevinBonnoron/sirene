import type { InferenceServer, SyncPolicy } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Link } from '@tanstack/react-router';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { inferenceServerClient } from '@/clients/inference-server.client';
import { inferenceServerCollection } from '@/collections';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useIsMobile } from '@/hooks/use-mobile';
import { useModels } from '@/hooks/use-models';
import { EMPTY_FEED, type ServerEventsFeed, useFleetEvents } from '@/hooks/use-server-events';
import { explainApiError } from '@/lib/api-error';
import { getStoredToken } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';
import { cn } from '@/lib/utils';
import { AddServerDialog } from './add-server-dialog';
import { GaugesSkeleton, ServerGauges, ServerHeading } from './server-gauges';

const STATUS_TEXT: Record<'online' | 'offline' | 'unknown', string> = {
  online: 'text-accent-sage',
  offline: 'text-destructive',
  unknown: 'text-muted-foreground',
};

const SYNC_POLICIES: SyncPolicy[] = ['all', 'cpu', 'gpu', 'none'];
const POLICY_CHIP: Record<SyncPolicy, string> = { all: '', cpu: 'bg-accent-sage/15 text-accent-sage', gpu: 'bg-primary/15 text-primary', none: 'bg-muted text-muted-foreground' };

function statusOf(server: InferenceServer): 'online' | 'offline' | 'unknown' {
  return server.lastHealth.status || 'unknown';
}

function formatRelative(iso: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) {
    return t('inferenceServers.neverChecked');
  }
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) {
    return t('inferenceServers.neverChecked');
  }
  const elapsed = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  let when: string;
  if (elapsed < 60) {
    when = t('studio.relativeJustNow');
  } else if (elapsed < 3600) {
    when = t('studio.relativeMinutes', { count: Math.floor(elapsed / 60) });
  } else if (elapsed < 86_400) {
    when = t('studio.relativeHours', { count: Math.floor(elapsed / 3600) });
  } else {
    when = t('studio.relativeDays', { count: Math.floor(elapsed / 86_400) });
  }
  return t('inferenceServers.lastChecked', { when });
}

export function InferenceServersPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { data: serversData, isReady } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }).orderBy(({ s }) => s.priority, 'desc'));
  const servers = serversData ?? [];
  const feeds = useFleetEvents(servers.filter((s) => s.enabled && statusOf(s) === 'online').map((s) => s.id));
  const { catalog, installations } = useModels();
  const [adding, setAdding] = useState(false);

  const modelsOn = (id: string) => installations.filter((i) => i.status === 'installed' && i.serverIds.includes(id)).map((i) => catalog.find((c) => c.id === i.id)?.name ?? i.id);

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar
        label={t('inferenceServers.title')}
        subtitle={t('inferenceServers.description')}
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t('inferenceServers.addServer')}
          </Button>
        }
      />
      <main className={cn('custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6', isMobile && 'pb-24')}>
        {isReady && servers.length === 0 && <p className="text-sm text-muted-foreground">{t('inferenceServers.empty')}</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {!isReady && [0, 1].map((i) => <ServerCardSkeleton key={i} />)}
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} models={modelsOn(server.id)} feed={feeds[server.id] ?? EMPTY_FEED} />
          ))}
          <button type="button" onClick={() => setAdding(true)} className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground">
            <Plus className="size-5" />
            {t('inferenceServers.addServer')}
          </button>
        </div>
      </main>
      <AddServerDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function ServerCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4" aria-busy>
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-44" />
      </div>
      <Skeleton className="h-3 w-40" />
      <GaugesSkeleton />
      <Skeleton className="h-2.5 w-28" />
    </div>
  );
}

function ServerCard({ server, models, feed }: { server: InferenceServer; models: string[]; feed: ServerEventsFeed }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleTest() {
    setTesting(true);
    try {
      // Probing from the browser would hit CORS; the API probes and PB realtime brings the result back.
      const token = getStoredToken();
      const res = await fetch(`${config.server.url}/inference-servers/${server.id}/test`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body && typeof body.message === 'string' ? body.message : t('inferenceServers.testFailedStatus', { status: res.status });
        throw new Error(message);
      }
    } catch (e) {
      toast.error(explainApiError(e, t('inferenceServers.testFailed')));
    } finally {
      setTesting(false);
    }
  }

  async function handleToggle(next: boolean) {
    setToggling(true);
    try {
      await inferenceServerClient.update(server.id, { enabled: next });
    } catch (e) {
      toast.error(explainApiError(e, t('inferenceServers.saveFailed')));
    } finally {
      setToggling(false);
    }
  }

  async function handleConfirmRemove() {
    setConfirmingDelete(false);
    try {
      await inferenceServerClient.remove(server.id);
    } catch (e) {
      toast.error(explainApiError(e, t('inferenceServers.removeFailed')));
    }
  }

  const status = statusOf(server);
  const statusKey = `inferenceServers.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;

  return (
    <>
      <div className={cn('relative flex flex-col gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60')}>
        <Link to="/admin/inference-servers/$serverId" params={{ serverId: server.id }} className="absolute inset-0 rounded-lg" aria-label={t('dashboard.openDetails', { name: server.name })} />
        <div className="flex items-start justify-between gap-2">
          <div className={cn(!server.enabled && 'opacity-60')}>
            <ServerHeading server={server} />
          </div>
          <div className="relative z-10 flex shrink-0 items-center gap-0.5">
            <Switch checked={server.enabled} onCheckedChange={handleToggle} disabled={toggling} className="mr-1.5 scale-90" aria-label={t(server.enabled ? 'inferenceServers.disable' : 'inferenceServers.enable')} />
            <Button variant="ghost" size="icon" onClick={handleTest} disabled={testing} className="size-7 text-muted-foreground" aria-label={t('inferenceServers.test')}>
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="size-7 text-muted-foreground" aria-label={t('common.edit')}>
              <Pencil className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setConfirmingDelete(true)} className="size-7 text-muted-foreground hover:text-destructive" aria-label={t('common.delete')}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        <p className={cn('text-xs', !server.enabled && 'opacity-60')}>
          <span className={cn('font-medium', STATUS_TEXT[status])}>{t(statusKey)}</span>
          <span className="ml-2 text-muted-foreground">{formatRelative(server.lastHealth.at, t)}</span>
          {server.lastHealth.error && status === 'offline' && <span className="ml-2 text-destructive">{server.lastHealth.error}</span>}
        </p>
        {status === 'online' && server.enabled && <ServerGauges server={server} feed={feed} />}
        <div className={cn('relative z-10 mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground', !server.enabled && 'opacity-60')}>
          {models.length === 0 ? (
            <span>{t('inferenceServers.modelCount', { count: 0 })}</span>
          ) : (
            <Popover>
              <PopoverTrigger className="rounded underline decoration-dotted underline-offset-2 hover:text-foreground">{t('inferenceServers.modelCount', { count: models.length })}</PopoverTrigger>
              <PopoverContent align="start" className="w-auto max-w-72 p-2">
                <ul className="custom-scrollbar max-h-56 space-y-0.5 overflow-y-auto text-xs">
                  {models.map((m) => (
                    <li key={m} className="truncate px-1">
                      {m}
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
          <span>{t('inferenceServers.priorityValue', { count: server.priority })}</span>
          {server.syncPolicy !== 'all' && <span className={cn('rounded px-1 py-px font-medium', POLICY_CHIP[server.syncPolicy])}>{t(`inferenceServers.syncPolicies.${server.syncPolicy}`)}</span>}
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('inferenceServers.editServer')}</DialogTitle>
            <DialogDescription className="truncate font-mono text-xs">{server.url}</DialogDescription>
          </DialogHeader>
          <ServerForm server={server} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={(open) => !open && setConfirmingDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inferenceServers.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('inferenceServers.deleteDescription', { name: server.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ServerForm({ server, onCancel, onSaved }: { server?: InferenceServer; onCancel: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const reactId = useId();
  const nameId = `${reactId}-name`;
  const urlId = `${reactId}-url`;
  const tokenId = `${reactId}-token`;
  const priorityId = `${reactId}-priority`;
  const syncPolicyId = `${reactId}-syncpolicy`;
  const [name, setName] = useState(server?.name ?? '');
  const [url, setUrl] = useState(server?.url ?? 'http://localhost:8000');
  // PB never returns authToken, so it can't be pre-filled: an empty field keeps the current one.
  const [authToken, setAuthToken] = useState('');
  const [priority, setPriority] = useState(String(server?.priority ?? 0));
  const [syncPolicy, setSyncPolicy] = useState<SyncPolicy>(server?.syncPolicy ?? 'all');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (saving || !name.trim() || !url.trim()) {
      return;
    }
    const payload: { name: string; url: string; priority: number; enabled: boolean; syncPolicy: SyncPolicy; authToken?: string } = {
      name: name.trim(),
      url: url.trim().replace(/\/$/, ''),
      priority: Number.parseInt(priority, 10) || 0,
      enabled: server?.enabled ?? true,
      syncPolicy,
    };
    if (authToken.trim()) {
      payload.authToken = authToken.trim();
    }
    setSaving(true);
    try {
      if (server) {
        await inferenceServerClient.update(server.id, payload);
      } else {
        await inferenceServerClient.create({ ...payload, authToken: payload.authToken ?? '' });
      }
      onSaved();
    } catch (e) {
      toast.error(explainApiError(e, t('inferenceServers.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="space-y-5"
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>{t('inferenceServers.name')}</Label>
          <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('inferenceServers.namePlaceholder')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={urlId}>{t('inferenceServers.url')}</Label>
          <Input id={urlId} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('inferenceServers.urlPlaceholder')} className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={tokenId}>{t('inferenceServers.authToken')}</Label>
          <Input id={tokenId} value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={server ? t('inferenceServers.authTokenEditPlaceholder') : t('inferenceServers.authTokenPlaceholder')} className="font-mono text-xs" />
          <p className="text-2xs text-muted-foreground">{server ? t('inferenceServers.authTokenEditHint') : t('inferenceServers.authTokenHint')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={syncPolicyId}>{t('inferenceServers.syncPolicy')}</Label>
          <Select value={syncPolicy} onValueChange={(v) => setSyncPolicy(v as SyncPolicy)}>
            <SelectTrigger id={syncPolicyId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYNC_POLICIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`inferenceServers.syncPolicies.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-2xs text-muted-foreground">{t('inferenceServers.syncPolicyHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={priorityId}>{t('inferenceServers.priority')}</Label>
          <Input id={priorityId} type="number" value={priority} onChange={(e) => setPriority(e.target.value)} className="font-mono" />
          <p className="text-2xs text-muted-foreground">{t('inferenceServers.priorityHint')}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving} className="gap-1.5">
          <X className="size-3.5" />
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={saving || !name.trim() || !url.trim()}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
