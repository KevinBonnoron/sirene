import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { explainApiError } from '@/lib/api-error';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/providers/auth-provider';

const MIN_PASSWORD = 8;

/** Shown in place of the app: the account holds a password someone else chose. */
export function ForcedPasswordChange() {
  const { t } = useTranslation();
  const { user, login, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      return;
    }
    if (password.length < MIN_PASSWORD) {
      toast.error(t('validators.minLength', { count: MIN_PASSWORD }));
      return;
    }
    if (password !== confirm) {
      toast.error(t('validators.passwordMismatch'));
      return;
    }
    setSaving(true);
    try {
      // PocketBase asks a record for its old password before replacing it; only an admin
      // acting through the manage rule is exempt.
      await pb.collection('users').update(user.id, { oldPassword: current, password, passwordConfirm: confirm });
      // Changing a password rotates the token key, so the old session is already dead.
      await login(user.email, password);
      await refresh();
    } catch (err) {
      toast.error(explainApiError(err, t('forcedPassword.failed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-2xl tracking-tight">{t('forcedPassword.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('forcedPassword.description')}</p>
        <form onSubmit={submit} className="mt-8 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="forced-password-current">{t('forcedPassword.current')}</Label>
            <Input id="forced-password-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forced-password">{t('forcedPassword.newPassword')}</Label>
            <Input id="forced-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forced-password-confirm">{t('forcedPassword.confirm')}</Label>
            <Input id="forced-password-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={saving || !current || !password || !confirm}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('forcedPassword.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
