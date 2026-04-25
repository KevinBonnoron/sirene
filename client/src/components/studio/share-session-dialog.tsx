import type { Session } from '@sirene/shared';
import { Check, Copy, Globe, Loader2, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { sessionClient } from '@/clients/session.client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

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

  // Reset the copy-confirmation after 2s so the button doesn't stay stuck on "Copied".
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
      // PB realtime push will land the new `public` value into the sessionCollection cache.
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

        {/* Visibility toggle — segmented Private / Public buttons */}
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border-subtle bg-bg-elevated p-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleToggle(false)}
            className={cn('flex items-center justify-center gap-2 rounded px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50', !isPublic ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            <Lock className="size-3.5" />
            {t('studio.sharePrivate')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleToggle(true)}
            className={cn('flex items-center justify-center gap-2 rounded px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50', isPublic ? 'bg-accent-amber/15 text-accent-amber shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            {busy && isPublic ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
            {t('studio.sharePublic')}
          </button>
        </div>

        {/* URL row — only shown when public; private state shows a quiet hint instead. */}
        {isPublic ? (
          <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2">
            <Globe className="size-3.5 shrink-0 text-accent-amber" />
            <input value={shareUrl} readOnly className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none" onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="ghost" onClick={handleCopy} className="shrink-0 gap-1.5">
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
