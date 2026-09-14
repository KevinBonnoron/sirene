import { Camera, Loader2, X } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { meClient } from '@/clients/me.client';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { explainApiError } from '@/lib/api-error';
import { setStoredToken } from '@/lib/auth-interceptor';
import { pb } from '@/lib/pocketbase';
import { avatarUrl, userInitials } from '@/lib/user-avatar';
import { useAuth } from '@/providers/auth-provider';
import { ApiKeysSection } from './api-keys-section';
import { AppearanceSection } from './appearance-section';
import { CloudKeysSection } from './cloud-keys-section';

const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml';

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="max-w-md space-y-3">{children}</div>
    </section>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { user, login, refresh } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [email, setEmail] = useState(user?.email ?? '');
  const [emailPassword, setEmailPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) {
    return null;
  }

  const displayName = user.name.trim() || user.email;

  async function changeAvatar(file: File | null) {
    if (!user) {
      return;
    }
    setAvatarBusy(true);
    try {
      await pb.collection('users').update(user.id, { avatar: file });
      await refresh();
      toast.success(t('profile.avatar.saved'));
    } catch (e) {
      toast.error(explainApiError(e, t('profile.avatar.saveFailed')));
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (!user || name.trim() === user.name) {
      return;
    }
    setSavingName(true);
    try {
      await pb.collection('users').update(user.id, { name: name.trim() });
      await refresh();
      toast.success(t('profile.name.saved'));
    } catch (err) {
      toast.error(explainApiError(err, t('profile.name.saveFailed')));
    } finally {
      setSavingName(false);
    }
  }

  async function saveEmail(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      return;
    }
    setSavingEmail(true);
    try {
      const { token } = await meClient.updateEmail(email.trim(), emailPassword);
      setStoredToken(token);
      await refresh();
      setEmailPassword('');
      toast.success(t('profile.email.saved'));
    } catch (err) {
      toast.error(explainApiError(err, t('profile.email.saveFailed')));
    } finally {
      setSavingEmail(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t('validators.minLength', { count: 8 }));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('validators.passwordMismatch'));
      return;
    }
    setSavingPassword(true);
    try {
      await pb.collection('users').update(user.id, { oldPassword, password: newPassword, passwordConfirm: confirmPassword });
      await login(user.email, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(t('profile.password.saved'));
    } catch (err) {
      const pbError = err as { data?: { data?: Record<string, { code?: string }> } };
      if (pbError?.data?.data?.oldPassword?.code === 'validation_invalid_old_password') {
        toast.error(t('profile.password.invalidCurrent'));
      } else {
        toast.error(explainApiError(err, t('profile.password.saveFailed')));
      }
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar label={t('nav.profile')} subtitle={t('profile.subtitle')} />
      <main className={`custom-scrollbar flex flex-1 flex-col gap-8 overflow-y-auto p-6 ${isMobile ? 'pb-24' : ''}`}>
        <div className="flex items-center gap-4">
          <div className="relative">
            <button type="button" className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => fileRef.current?.click()} disabled={avatarBusy} aria-label={t('profile.avatar.change')}>
              <Avatar className="size-20 text-xl">
                <AvatarImage src={avatarUrl(user)} alt="" />
                <AvatarFallback>{userInitials(user)}</AvatarFallback>
              </Avatar>
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{avatarBusy ? <Loader2 className="size-5 animate-spin text-white" /> : <Camera className="size-5 text-white" />}</span>
            </button>
            {user.avatar && (
              <Button type="button" variant="outline" size="icon" className="absolute -right-1 -top-1 size-6 rounded-full" disabled={avatarBusy} onClick={() => changeAvatar(null)} aria-label={t('profile.avatar.remove')}>
                <X className="size-3" />
              </Button>
            )}
            <input ref={fileRef} type="file" accept={AVATAR_ACCEPT} className="hidden" onChange={(e) => changeAvatar(e.target.files?.[0] ?? null)} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{displayName}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <Separator />

        <form onSubmit={saveName}>
          <Section title={t('profile.name.title')} description={t('profile.name.description')}>
            <div className="space-y-2">
              <Label htmlFor="profile-name">{t('profile.name.label')}</Label>
              <Input id="profile-name" value={name} autoComplete="name" disabled={savingName} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" size="sm" disabled={savingName || name.trim() === user.name}>
              {savingName && <Loader2 className="size-4 animate-spin" />}
              {t('profile.save')}
            </Button>
          </Section>
        </form>

        <Separator />

        <form onSubmit={saveEmail}>
          <Section title={t('profile.email.title')} description={t('profile.email.description')}>
            <div className="space-y-2">
              <Label htmlFor="profile-email">{t('profile.email.label')}</Label>
              <Input id="profile-email" type="email" value={email} autoComplete="email" disabled={savingEmail} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email-password">{t('profile.currentPassword')}</Label>
              <Input id="profile-email-password" type="password" value={emailPassword} autoComplete="current-password" disabled={savingEmail} onChange={(e) => setEmailPassword(e.target.value)} />
            </div>
            <Button type="submit" size="sm" disabled={savingEmail || !emailPassword || email.trim() === user.email}>
              {savingEmail && <Loader2 className="size-4 animate-spin" />}
              {t('profile.email.submit')}
            </Button>
          </Section>
        </form>

        <Separator />

        <form onSubmit={savePassword}>
          <Section title={t('profile.password.title')} description={t('profile.password.description')}>
            <div className="space-y-2">
              <Label htmlFor="profile-old-password">{t('profile.currentPassword')}</Label>
              <Input id="profile-old-password" type="password" value={oldPassword} autoComplete="current-password" disabled={savingPassword} onChange={(e) => setOldPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-new-password">{t('profile.password.newPassword')}</Label>
              <Input id="profile-new-password" type="password" value={newPassword} autoComplete="new-password" disabled={savingPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-confirm-password">{t('profile.password.confirm')}</Label>
              <Input id="profile-confirm-password" type="password" value={confirmPassword} autoComplete="new-password" disabled={savingPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <Button type="submit" size="sm" disabled={savingPassword || !oldPassword || !newPassword || !confirmPassword}>
              {savingPassword && <Loader2 className="size-4 animate-spin" />}
              {t('profile.password.submit')}
            </Button>
          </Section>
        </form>

        <Separator />

        <Section title={t('appearance.title')} description={t('appearance.description')}>
          <AppearanceSection />
        </Section>

        <Separator />

        <Section title={t('cloudKeys.title')} description={t('cloudKeys.description')}>
          <CloudKeysSection />
        </Section>

        <Separator />

        <ApiKeysSection />
      </main>
    </div>
  );
}
