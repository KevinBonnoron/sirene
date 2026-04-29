import { Check, Copy, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { inferenceServerClient } from '@/clients/inference-server.client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { explainApiError } from '@/lib/api-error';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Worker mode landed after the v0.0.1 tag was cut, so there is no tagged release
// the installer can be pinned to today. Use `main` and surface a security note in
// the dialog hint; once a worker-capable release exists this should switch back
// to a fetched-version-based pin (the /version endpoint is already wired).
const INSTALL_REF = 'main';
const INSTALL_COMMAND = `curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/${INSTALL_REF}/install.sh | INSTALL_MODE=worker bash`;

export function AddServerDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [priority, setPriority] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      return;
    }
    setName('');
    setUrl('');
    setAuthToken('');
    setPriority('0');
    setEnabled(true);
    setCopied(false);
  }, [open]);

  async function copy() {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleSubmit() {
    // Early-out before the React state flush has had a chance to disable the button
    // (form double-submit, Enter twice, etc.) so we can't double-create the same server.
    if (saving || !name.trim() || !url.trim()) {
      return;
    }
    setSaving(true);
    try {
      await inferenceServerClient.create({
        name: name.trim(),
        url: url.trim().replace(/\/$/, ''),
        enabled,
        priority: Number.parseInt(priority, 10) || 0,
        auth_token: authToken.trim() || undefined,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(explainApiError(e, t('inferenceServers.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl sm:grid-cols-[minmax(0,1fr)]">
        <DialogHeader className="min-w-0">
          <DialogTitle>{t('inferenceServers.addDialog.title')}</DialogTitle>
          <DialogDescription>{t('inferenceServers.addDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('inferenceServers.addDialog.installLabel')}</p>
          <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-background/50 p-2">
            <code className="block min-w-0 flex-1 truncate font-mono text-[11px] leading-relaxed" title={INSTALL_COMMAND}>
              {INSTALL_COMMAND}
            </code>
            <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={copy} aria-label={t('studio.copy')}>
              {copied ? <Check className="size-3.5 text-accent-sage" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{t('inferenceServers.addDialog.installHint')}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">{t('inferenceServers.name')}</Label>
              <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('inferenceServers.namePlaceholder')} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-url">{t('inferenceServers.url')}</Label>
              <Input id="add-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('inferenceServers.urlPlaceholder')} className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="add-token">{t('inferenceServers.authToken')}</Label>
              <Input id="add-token" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={t('inferenceServers.authTokenPlaceholder')} className="font-mono text-xs" />
              <p className="text-[10px] text-muted-foreground">{t('inferenceServers.authTokenHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-priority">{t('inferenceServers.priority')}</Label>
              <Input id="add-priority" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
              <p className="text-[10px] text-dim">{t('inferenceServers.priorityHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-enabled">{t('inferenceServers.enabled')}</Label>
              <div className="flex h-9 items-center">
                <Switch id="add-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !url.trim()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
