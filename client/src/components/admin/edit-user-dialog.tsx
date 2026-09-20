import type { User } from '@sirene/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { explainApiError } from '@/lib/api-error';
import { pb } from '@/lib/pocketbase';

const MIN_PASSWORD = 8;

export function EditUserDialog({ user, isSelf, open, onOpenChange }: { user: User; isSelf: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(user.name);
  const [disabled, setDisabled] = useState(Boolean(user.disabled));
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (open) {
      setName(user.name);
      setDisabled(Boolean(user.disabled));
      setPassword('');
    }
  }, [open, user.name, user.disabled]);

  const save = useMutation({
    // One call rather than one per field: the live collection picks the change up from the
    // realtime event, and a password is not part of the record the collection holds.
    mutationFn: () => {
      // The rule refuses disabled on your own record, so sending it unchanged still fails.
      const changes: Record<string, unknown> = isSelf ? { name: name.trim() } : { name: name.trim(), disabled };
      if (password) {
        changes.password = password;
        changes.passwordConfirm = password;
      }
      // mustChangePassword is set by the server from who is asking, never from here.
      return pb.collection('users').update(user.id, changes);
    },
    onSuccess: () => {
      toast.success(t('users.saved'));
      onOpenChange(false);
    },
    onError: (err) => toast.error(explainApiError(err, t('users.saveFailed'))),
  });

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('users.editTitle', { name: user.name || user.email })}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-user-name">{t('users.name')}</Label>
            <Input id="edit-user-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-user-password">{t('users.newPassword')}</Label>
            <Input id="edit-user-password" type="password" autoComplete="new-password" placeholder={t('users.passwordUnchanged')} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className={passwordTooShort ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{passwordTooShort ? t('validators.minLength', { count: MIN_PASSWORD }) : t('users.passwordHint')}</p>
          </div>
          {!isSelf && (
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="edit-user-active">{t('users.active')}</Label>
                <p className="text-xs text-muted-foreground">{t('users.activeHint')}</p>
              </div>
              <Switch id="edit-user-active" checked={!disabled} onCheckedChange={(active) => setDisabled(!active)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button onClick={() => save.mutate()} disabled={save.isPending || passwordTooShort || !name.trim()}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
