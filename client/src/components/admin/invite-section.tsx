import type { Invite, InviteCreated } from '@sirene/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { inviteClient } from '@/clients/invite.client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { explainApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

export const INVITES_KEY = ['admin-invites'] as const;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function PendingInviteRow({ invite, className }: { invite: Invite; className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const revoke = useMutation({
    mutationFn: () => inviteClient.revoke(invite.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INVITES_KEY });
      toast.success(t('invites.revoked'));
    },
    onError: (err) => toast.error(explainApiError(err, t('invites.revokeFailed'))),
  });

  return (
    <div className={cn(className, 'text-muted-foreground')}>
      <p className="truncate text-sm">{invite.email}</p>
      <span>
        <Badge variant="outline" className="text-2xs">
          {t('invites.pending')}
        </Badge>
      </span>
      <span className="text-xs">{t('invites.expires', { date: formatDate(invite.expiresAt) })}</span>
      <span className="text-xs">—</span>
      <div className="flex justify-end">
        <Button variant="outline" size="icon" className="size-7 hover:text-destructive" onClick={() => revoke.mutate()} disabled={revoke.isPending} aria-label={t('invites.revoke')}>
          {revoke.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export function InviteDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (invite: InviteCreated) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');

  const create = useMutation({
    mutationFn: () => inviteClient.create(email.trim()),
    onSuccess: (invite) => {
      qc.invalidateQueries({ queryKey: INVITES_KEY });
      setEmail('');
      onOpenChange(false);
      onCreated(invite);
    },
    onError: (err) => toast.error(explainApiError(err, t('invites.createFailed'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('invites.invite')}</DialogTitle>
          <DialogDescription>{t('invites.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="invite-email">{t('invites.email')}</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            autoComplete="off"
            placeholder="someone@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email.trim() && !create.isPending) {
                create.mutate();
              }
            }}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button onClick={() => create.mutate()} disabled={!email.trim() || create.isPending}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('invites.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InviteLinkDialog({ created, onClose }: { created: InviteCreated | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const link = created ? `${window.location.origin}/register?invite=${encodeURIComponent(created.token)}` : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('invites.copyFailed'));
    }
  }

  return (
    <Dialog open={created !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('invites.linkTitle', { email: created?.email })}</DialogTitle>
          <DialogDescription>{t('invites.linkDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={link} className="flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" size="icon" onClick={copy} aria-label={t('invites.copy')}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{t('common.close')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
