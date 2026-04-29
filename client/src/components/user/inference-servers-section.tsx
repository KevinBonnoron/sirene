import type { InferenceServer } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { inferenceServerClient } from '@/clients/inference-server.client';
import { inferenceServerCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { explainApiError } from '@/lib/api-error';
import { getStoredToken } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';
import { cn } from '@/lib/utils';
import { AddServerDialog } from './add-server-dialog';

const STATUS_DOT: Record<'online' | 'offline' | 'unknown', string> = {
  online: 'bg-accent-sage',
  offline: 'bg-destructive',
  unknown: 'bg-muted-foreground/40',
};

const STATUS_TEXT: Record<'online' | 'offline' | 'unknown', string> = {
  online: 'text-accent-sage',
  offline: 'text-destructive',
  unknown: 'text-muted-foreground',
};

function statusOf(server: InferenceServer): 'online' | 'offline' | 'unknown' {
  return server.last_health_status || 'unknown';
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

export function InferenceServersSection() {
  const { t } = useTranslation();
  const { data: serversData } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }).orderBy(({ s }) => s.priority, 'desc'));
  // useLiveQuery yields undefined on the very first render before the collection
  // has hydrated; default to an empty array so neither .length nor .map throws.
  const servers = serversData ?? [];
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inferenceServers.title')}</CardTitle>
        <CardDescription>{t('inferenceServers.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {servers.length === 0 && <p className="text-sm text-muted-foreground">{t('inferenceServers.empty')}</p>}

        {servers.map((server) => (
          <ServerRow key={server.id} server={server} />
        ))}

        <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="gap-2">
          <Plus className="size-3.5" />
          {t('inferenceServers.addServer')}
        </Button>

        <AddServerDialog open={adding} onOpenChange={setAdding} />
      </CardContent>
    </Card>
  );
}

function ServerRow({ server }: { server: InferenceServer }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return <ServerForm server={server} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />;
  }

  async function handleTest() {
    setTesting(true);
    try {
      // Forced probe goes through the API because the browser can't reliably probe arbitrary
      // inference URLs (CORS). PB realtime delivers the persisted result back here.
      const token = getStoredToken();
      const res = await fetch(`${config.server.url}/inference-servers/${server.id}/test`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        // Surface the server's `{ message }` body when present so the user gets a real
        // explanation (DNS, 502 from the worker, etc.) instead of a bare HTTP status.
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
      <div className={cn('flex items-center gap-3 rounded-lg border border-border-subtle bg-card/40 p-3', !server.enabled && 'opacity-60')}>
        <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm" title={server.name}>
            {server.name}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={server.url}>
            {server.url}
          </p>
          <p className="text-xs">
            <span className={cn('font-medium', STATUS_TEXT[status])}>{t(statusKey)}</span>
            <span className="ml-2 text-muted-foreground">{formatRelative(server.last_health_at, t)}</span>
            {server.last_health_error && status === 'offline' && <span className="ml-2 text-destructive">— {server.last_health_error}</span>}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={handleTest} disabled={testing} className="size-8" aria-label={t('inferenceServers.test')}>
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="size-8 text-muted-foreground" aria-label={t('common.edit')}>
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setConfirmingDelete(true)} className="size-8 text-muted-foreground hover:text-destructive" aria-label={t('common.delete')}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

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
  const enabledId = `${reactId}-enabled`;
  const [name, setName] = useState(server?.name ?? '');
  const [url, setUrl] = useState(server?.url ?? 'http://localhost:8000');
  // PB hides auth_token, so we can't pre-fill the existing value. Treat the field
  // as "leave blank to keep current; type to overwrite" via the dirty flag.
  const [authToken, setAuthToken] = useState('');
  const [authTokenDirty, setAuthTokenDirty] = useState(false);
  const [priority, setPriority] = useState(String(server?.priority ?? 0));
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    // Bail before the disabled-button state propagates so a fast double-submit
    // can't fire two create/update requests for the same form.
    if (saving || !name.trim() || !url.trim()) {
      return;
    }
    const payload: { name: string; url: string; priority: number; enabled: boolean; auth_token?: string } = {
      name: name.trim(),
      url: url.trim().replace(/\/$/, ''),
      priority: Number.parseInt(priority, 10) || 0,
      enabled,
    };
    if (authTokenDirty) {
      // Empty string clears the token server-side; non-empty replaces it.
      payload.auth_token = authToken.trim();
    }
    setSaving(true);
    try {
      if (server) {
        await inferenceServerClient.update(server.id, payload);
      } else {
        await inferenceServerClient.create({ ...payload, auth_token: payload.auth_token ?? '' });
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
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>{t('inferenceServers.name')}</Label>
          <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('inferenceServers.namePlaceholder')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={urlId}>{t('inferenceServers.url')}</Label>
          <Input id={urlId} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('inferenceServers.urlPlaceholder')} className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={tokenId}>{t('inferenceServers.authToken')}</Label>
          <Input
            id={tokenId}
            value={authToken}
            onChange={(e) => {
              setAuthToken(e.target.value);
              setAuthTokenDirty(true);
            }}
            placeholder={server ? t('inferenceServers.authTokenEditPlaceholder') : t('inferenceServers.authTokenPlaceholder')}
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-muted-foreground">{server ? t('inferenceServers.authTokenEditHint') : t('inferenceServers.authTokenHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={priorityId}>{t('inferenceServers.priority')}</Label>
          <Input id={priorityId} type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          <p className="text-[10px] text-dim">{t('inferenceServers.priorityHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={enabledId}>{t('inferenceServers.enabled')}</Label>
          <div className="flex h-9 items-center">
            <Switch id={enabledId} checked={enabled} onCheckedChange={setEnabled} />
          </div>
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
