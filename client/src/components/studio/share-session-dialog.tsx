import type { Session } from '@sirene/shared';
import { Check, Copy, Globe, Loader2, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { sessionClient } from '@/clients/session.client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
}

export function ShareSessionDialog({ open, onOpenChange, session }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const isPublic = Boolean(session?.public);
  const shareUrl = useMemo(() => (session ? `${window.location.origin}/share/${session.id}` : ''), [session]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function handleToggle(next: boolean) {
    if (!session || busy) {
      return;
    }
    setBusy(true);
    try {
      await sessionClient.setPublic(session.id, next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('studio.shareFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      toast.error(t('studio.copyFailed'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl tracking-tight">{t('studio.shareTitle')}</DialogTitle>
          <DialogDescription>{t('studio.shareDescription')}</DialogDescription>
        </DialogHeader>

        <ToggleGroup
          type="single"
          value={isPublic ? 'public' : 'private'}
          onValueChange={(v) => {
            if (v === 'private' || v === 'public') {
              handleToggle(v === 'public');
            }
          }}
          variant="outline"
          className="w-full *:flex-1"
          disabled={busy}
        >
          <ToggleGroupItem value="private" aria-label={t('studio.sharePrivate')}>
            <Lock className="size-3.5" />
            {t('studio.sharePrivate')}
          </ToggleGroupItem>
          <ToggleGroupItem value="public" aria-label={t('studio.sharePublic')} className="data-[state=on]:bg-accent-amber/15 data-[state=on]:text-accent-amber">
            {busy && isPublic ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
            {t('studio.sharePublic')}
          </ToggleGroupItem>
        </ToggleGroup>

        {isPublic ? (
          <div className="flex items-center gap-2">
            <Input value={shareUrl} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0 gap-1.5">
              {copied ? <Check className="size-3.5 text-accent-sage" /> : <Copy className="size-3.5" />}
              <span>{copied ? t('studio.copied') : t('studio.copy')}</span>
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('studio.sharePrivateHint')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
