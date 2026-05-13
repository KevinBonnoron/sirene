import { API_KEY_SCOPES, type ApiKeyCreated, type ApiKeyScope, type ApiKeySummary } from '@sirene/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiKeyClient } from '@/clients/api-key.client';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { explainApiError } from '@/lib/api-error';

function formatDate(iso: string | undefined, t: (k: string) => string): string {
  if (!iso) {
    return t('apiKeys.never');
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return t('apiKeys.never');
  }
  return date.toLocaleDateString();
}

export function ApiKeysSection() {
  const { t } = useTranslation();
  const {
    data: keys,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiKeyClient.list(),
  });
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<ApiKeyCreated | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('apiKeys.title')}</CardTitle>
        <CardDescription>{t('apiKeys.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* The query can fail (network / server outage); falling back to the
            empty-state copy would lie about there being no keys, so surface
            the error explicitly with a way to retry. */}
        {isError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="text-destructive">{explainApiError(error, t('apiKeys.loadFailed'))}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}

        {!isLoading && !isError && (keys?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">{t('apiKeys.empty')}</p>}

        {keys?.map((key) => (
          <KeyRow key={key.id} apiKey={key} />
        ))}

        <Button variant="outline" size="sm" onClick={() => setCreating(true)} className="gap-2">
          <Plus className="size-3.5" />
          {t('apiKeys.create')}
        </Button>

        <CreateKeyDialog open={creating} onOpenChange={setCreating} onCreated={setRevealed} />
        <RevealKeyDialog created={revealed} onClose={() => setRevealed(null)} />
      </CardContent>
    </Card>
  );
}

function KeyRow({ apiKey }: { apiKey: ApiKeySummary }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const revoke = useMutation({
    mutationFn: () => apiKeyClient.revoke(apiKey.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success(t('apiKeys.revoked'));
    },
    onError: (err) => toast.error(explainApiError(err, t('apiKeys.revokeFailed'))),
  });

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-card/40 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm" title={apiKey.name}>
            {apiKey.name}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">{apiKey.prefix}...</p>
          <p className="text-xs text-muted-foreground">
            {t('apiKeys.created')}: {formatDate(apiKey.created, t)}
            <span className="ml-3">
              {t('apiKeys.lastUsed')}: {formatDate(apiKey.lastUsedAt, t)}
            </span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {apiKey.scopes === null ? (
              <Badge variant="secondary" className="text-[10px]">
                {t('apiKeys.fullAccess')}
              </Badge>
            ) : (
              apiKey.scopes.map((scope) => (
                <Badge key={scope} variant="outline" className="text-[10px] font-mono">
                  {scope}
                </Badge>
              ))
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setConfirming(true)} disabled={revoke.isPending} className="size-8 text-muted-foreground hover:text-destructive" aria-label={t('apiKeys.revoke')}>
          {revoke.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('apiKeys.revokeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('apiKeys.revokeDescription', { name: apiKey.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                revoke.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('apiKeys.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (key: ApiKeyCreated) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nameId = useId();
  const [name, setName] = useState('');
  const [fullAccess, setFullAccess] = useState(true);
  const [selectedScopes, setSelectedScopes] = useState<Set<ApiKeyScope>>(new Set());

  const create = useMutation({
    // `null` signals "full access" to the server; an array is the explicit
    // restricted set. An empty array is rejected server-side so we never
    // send one here (the submit button is disabled when no scope is picked).
    mutationFn: () => apiKeyClient.create(name.trim(), fullAccess ? null : Array.from(selectedScopes)),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      onOpenChange(false);
      setName('');
      setFullAccess(true);
      setSelectedScopes(new Set());
      onCreated(created);
    },
    onError: (err) => toast.error(explainApiError(err, t('apiKeys.createFailed'))),
  });

  const canSubmit = name.trim().length > 0 && (fullAccess || selectedScopes.size > 0) && !create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) {
          onOpenChange(next);
          if (!next) {
            setName('');
            setFullAccess(true);
            setSelectedScopes(new Set());
          }
        }
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('apiKeys.createTitle')}</DialogTitle>
          <DialogDescription>{t('apiKeys.createDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={nameId}>{t('apiKeys.name')}</Label>
            <Input
              id={nameId}
              placeholder={t('apiKeys.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) {
                  create.mutate();
                }
              }}
            />
          </div>
          <ScopePicker fullAccess={fullAccess} onFullAccessChange={setFullAccess} selected={selectedScopes} onSelectedChange={setSelectedScopes} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={create.isPending}>
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button disabled={!canSubmit} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t('apiKeys.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Multi-select for API-key scopes. The "Full access" toggle is the default
 *  because the most common use (CLI on a trusted laptop) wants everything.
 *  Turning it off reveals the per-capability switches so the user can narrow. */
export function ScopePicker({
  fullAccess,
  onFullAccessChange,
  selected,
  onSelectedChange,
  available,
}: {
  fullAccess: boolean;
  onFullAccessChange: (next: boolean) => void;
  selected: Set<ApiKeyScope>;
  onSelectedChange: (next: Set<ApiKeyScope>) => void;
  /** Restrict the picker to a subset (e.g. when the CLI requested only some).
   *  Omitted = all known scopes. */
  available?: readonly ApiKeyScope[];
}) {
  const { t } = useTranslation();
  const fullAccessId = useId();
  const list = useMemo<readonly ApiKeyScope[]>(() => available ?? API_KEY_SCOPES, [available]);

  function toggle(scope: ApiKeyScope, on: boolean) {
    const next = new Set(selected);
    if (on) {
      next.add(scope);
    } else {
      next.delete(scope);
    }
    onSelectedChange(next);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor={fullAccessId} className="text-sm font-medium">
            {t('apiKeys.fullAccess')}
          </Label>
          <p className="text-xs text-muted-foreground">{t('apiKeys.fullAccessHint')}</p>
        </div>
        <Switch id={fullAccessId} checked={fullAccess} onCheckedChange={onFullAccessChange} />
      </div>

      {!fullAccess && (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <p className="text-xs text-muted-foreground">{t('apiKeys.scopesHint')}</p>
          <div className="space-y-1.5">
            {list.map((scope) => (
              <ScopeRow key={scope} scope={scope} checked={selected.has(scope)} onChange={(on) => toggle(scope, on)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeRow({ scope, checked, onChange }: { scope: ApiKeyScope; checked: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-1 py-1">
      <Label htmlFor={id} className="cursor-pointer text-sm">
        <span className="font-mono text-xs text-muted-foreground">{scope}</span>
        <span className="ml-2">{t(`apiKeys.scopes.${scope}` as never)}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function RevealKeyDialog({ created, onClose }: { created: ApiKeyCreated | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!created) {
      return;
    }
    try {
      await navigator.clipboard.writeText(created.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('apiKeys.copyFailed'));
    }
  }

  return (
    <Dialog open={created != null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('apiKeys.revealTitle')}</DialogTitle>
          <DialogDescription>{t('apiKeys.revealDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={created?.secret ?? ''} className="flex-1 font-mono text-xs" />
          <Button onClick={handleCopy} size="icon" variant="outline" aria-label={t('apiKeys.copy')}>
            {copied ? <Check className="size-4 text-accent-sage" /> : <Copy className="size-4" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('apiKeys.copiedDone')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
