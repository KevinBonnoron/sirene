import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AudioWaveform, Loader2, Mic, Sparkles } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/providers/auth-provider';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const { login, register, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');

  if (user) {
    navigate({ to: '/' });
    return null;
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await login(form.get('email') as string, form.get('password') as string);
      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await register(form.get('email') as string, form.get('password') as string, form.get('name') as string);
      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.registerFailed'));
    } finally {
      setLoading(false);
    }
  }

  const features = [
    { icon: AudioWaveform, label: t('auth.feature1') },
    { icon: Mic, label: t('auth.feature2') },
    { icon: Sparkles, label: t('auth.feature3') },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel — branding */}
      <div className="relative hidden overflow-hidden bg-muted lg:flex lg:w-1/2">
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-cyan-500/10" />
        <div className="relative z-10 flex flex-1 flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <img src="/sirene.svg" alt="" className="size-10 rounded-lg" />
            <span className="text-lg font-semibold tracking-tight">{t('nav.appName')}</span>
          </div>

          <div className="max-w-md space-y-6">
            <h1 className="text-3xl font-bold leading-tight tracking-tight">{t('auth.heroTitle')}</h1>
            <p className="text-muted-foreground">{t('auth.heroSubtitle')}</p>
            <div className="space-y-3 pt-2">
              {features.map((f) => (
                <div key={f.label} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <f.icon className="size-4 text-primary" />
                  </div>
                  {f.label}
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground/50">{t('nav.appName')} — {t('nav.appSubtitle')}</p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
            <img src="/sirene.svg" alt="" className="size-14 rounded-xl" />
            <h2 className="text-xl font-bold">{t('nav.appName')}</h2>
          </div>

          <Card className="border-0 shadow-none sm:border sm:shadow-sm">
            <CardContent className="p-0 sm:p-8">
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight">
                  {mode === 'login' ? t('auth.welcome') : t('auth.createAccount')}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {mode === 'login' ? t('auth.welcomeSubtitle') : t('auth.createAccountSubtitle')}
                </p>
              </div>

              {error && (
                <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">{t('auth.email')}</Label>
                    <Input id="login-email" name="email" type="email" placeholder={t('auth.emailPlaceholder')} required autoComplete="email" className="h-11" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">{t('auth.password')}</Label>
                    <Input id="login-password" name="password" type="password" placeholder="••••••••" required minLength={8} autoComplete="current-password" className="h-11" />
                  </div>
                  <Button type="submit" className="h-11 w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {t('auth.login')}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="register-name">{t('auth.name')}</Label>
                    <Input id="register-name" name="name" type="text" placeholder={t('auth.namePlaceholder')} autoComplete="name" className="h-11" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">{t('auth.email')}</Label>
                    <Input id="register-email" name="email" type="email" placeholder={t('auth.emailPlaceholder')} required autoComplete="email" className="h-11" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password">{t('auth.password')}</Label>
                    <Input id="register-password" name="password" type="password" placeholder="••••••••" required minLength={8} autoComplete="new-password" className="h-11" />
                  </div>
                  <Button type="submit" className="h-11 w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {t('auth.register')}
                  </Button>
                </form>
              )}

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {mode === 'login' ? t('auth.noAccount') : t('auth.hasAccount')}{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login');
                    setError('');
                  }}
                >
                  {mode === 'login' ? t('auth.createAccount') : t('auth.login')}
                </button>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
