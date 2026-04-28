import type { InferenceServer } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { inferenceServerCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getStoredToken } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';
import { pb } from '@/lib/pocketbase';
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
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
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

/** PocketBase exposes per-field validation messages on ClientResponseError.
 *  Surface them so the user gets "Value must be unique" instead of "Failed to create record". */
function explainPbError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: Record<string, { message?: string }> } }).response;
    const fieldErrors = response?.data;
    if (fieldErrors) {
      const messages: string[] = [];
      for (const [field, info] of Object.entries(fieldErrors)) {
        if (info?.message) {
          messages.push(`${field}: ${info.message}`);
        }
      }
      if (messages.length > 0) {
        return messages.join('; ');
      }
    }
  }
  return err instanceof Error ? err.message : fallback;
}

export function InferenceServersSection() {
  const { t } = useTranslation();
  const { data: servers } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }).orderBy(({ s }) => s.priority, 'desc'));
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
        throw new Error(`Test failed (${res.status})`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  function handleConfirmRemove() {
    inferenceServerCollection.delete(server.id);
    setConfirmingDelete(false);
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
  const [name, setName] = useState(server?.name ?? '');
  const [url, setUrl] = useState(server?.url ?? 'http://localhost:8000');
  const [priority, setPriority] = useState(String(server?.priority ?? 0));
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !url.trim()) {
      return;
    }
    const payload = {
      name: name.trim(),
      url: url.trim().replace(/\/$/, ''),
      priority: Number.parseInt(priority, 10) || 0,
      enabled,
    };
    setSaving(true);
    try {
      if (server) {
        await pb.collection('inference_servers').update(server.id, payload);
      } else {
        await pb.collection('inference_servers').create({ ...payload, last_health_status: 'unknown' });
      }
      onSaved();
    } catch (e) {
      toast.error(explainPbError(e, t('inferenceServers.saveFailed')));
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
          <Label htmlFor="srv-name">{t('inferenceServers.name')}</Label>
          <Input id="srv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('inferenceServers.namePlaceholder')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="srv-url">{t('inferenceServers.url')}</Label>
          <Input id="srv-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('inferenceServers.urlPlaceholder')} className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="srv-priority">{t('inferenceServers.priority')}</Label>
          <Input id="srv-priority" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          <p className="text-[10px] text-dim">{t('inferenceServers.priorityHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="srv-enabled">{t('inferenceServers.enabled')}</Label>
          <div className="flex h-9 items-center">
            <Switch id="srv-enabled" checked={enabled} onCheckedChange={setEnabled} />
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
