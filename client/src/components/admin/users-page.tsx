import type { InviteCreated, User } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { userClient } from '@/clients/user.client';
import { invitationCollection, userCollection } from '@/collections';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { explainApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { InviteDialog, InviteLinkDialog, PendingInviteRow } from './invite-section';

const userGrid = 'grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_2.25rem] sm:items-center';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function UsersPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { user: me } = useAuth();
  const { data: users } = useLiveQuery((q) => q.from({ u: userCollection }));
  const { data: invites } = useLiveQuery((q) => q.from({ i: invitationCollection }));
  const [inviting, setInviting] = useState(false);
  const [created, setCreated] = useState<InviteCreated | null>(null);

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar
        label={t('users.title')}
        subtitle={t('users.description')}
        actions={
          <Button size="sm" onClick={() => setInviting(true)}>
            <UserPlus className="size-4" />
            {t('invites.invite')}
          </Button>
        }
      />
      <main className={cn('custom-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto p-6', isMobile && 'pb-24')}>
        <div className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-card/40">
          <div className={cn(userGrid, 'hidden text-2xs font-medium uppercase tracking-wide text-muted-foreground sm:grid')}>
            <span>{t('users.user')}</span>
            <span>{t('users.role')}</span>
            <span>{t('users.status')}</span>
            <span>{t('users.joined')}</span>
            <span className="sr-only">{t('users.remove')}</span>
          </div>
          {(users ?? []).map((entry) => (
            <UserRow key={entry.id} entry={entry} isSelf={entry.id === me?.id} />
          ))}
          {(invites ?? []).map((invite) => (
            <PendingInviteRow key={invite.id} invite={invite} className={userGrid} />
          ))}
        </div>
        <InviteDialog open={inviting} onOpenChange={setInviting} onCreated={setCreated} />
        <InviteLinkDialog created={created} onClose={() => setCreated(null)} />
      </main>
    </div>
  );
}

// Deletion goes through the API: voices, generations, sessions and settings all reference
// the account as required without cascade, so they have to go first, in order.
function UserRow({ entry, isSelf }: { entry: User; isSelf: boolean }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => userClient.remove(entry.id),
    onSuccess: () => toast.success(t('users.removed', { name: entry.name || entry.email })),
    onError: (err) => toast.error(explainApiError(err, t('users.removeFailed'))),
  });

  return (
    <>
      <div className={userGrid}>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{entry.name || entry.email}</p>
          {entry.name && <p className="truncate text-xs text-muted-foreground">{entry.email}</p>}
        </div>
        <span>
          <Badge variant={entry.role === 'admin' ? 'secondary' : 'outline'} className="text-2xs">
            {t(`users.roles.${entry.role}`)}
          </Badge>
        </span>
        <span className={cn('text-xs', entry.verified ? 'text-accent-sage' : 'text-muted-foreground')}>{t(entry.verified ? 'users.verified' : 'users.unverified')}</span>
        <span className="text-xs text-muted-foreground">{formatDate(entry.created)}</span>
        <div className="flex justify-end">
          {!isSelf && (
            <Button variant="outline" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => setConfirming(true)} disabled={remove.isPending} aria-label={t('users.remove')}>
              {remove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('users.removeTitle', { name: entry.name || entry.email })}</AlertDialogTitle>
            <AlertDialogDescription>{t('users.removeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                remove.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('users.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
