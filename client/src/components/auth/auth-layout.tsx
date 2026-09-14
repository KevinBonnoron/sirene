import { AudioWaveform, Mic, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';

const FEATURES = [
  { icon: AudioWaveform, labelKey: 'auth.feature1' },
  { icon: Mic, labelKey: 'auth.feature2' },
  { icon: Sparkles, labelKey: 'auth.feature3' },
] as const;

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel - branding (wide screens) */}
      <div className="relative hidden overflow-hidden bg-bg-elevated lg:flex lg:w-1/2">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-amber/10 via-transparent to-accent-violet/5" />
        <div className="relative z-10 mx-auto flex w-full max-w-md flex-col items-center justify-center p-12 text-center">
          <img src="/sirene.svg" alt="" className="size-20 rounded-2xl shadow-lg shadow-accent-amber/10" />
          <h1 className="mt-6 font-serif text-4xl tracking-tight">{t('nav.appName')}</h1>
          <p className="mt-3 text-lg text-foreground/90">{t('auth.heroTitle')}</p>
          <p className="mt-3 text-muted-foreground">{t('auth.heroSubtitle')}</p>
          <ul className="mt-8 space-y-3 text-left text-sm text-muted-foreground">
            {FEATURES.map((f) => (
              <li key={f.labelKey} className="flex items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-amber/10">
                  <f.icon className="size-4 text-accent-amber" />
                </div>
                {t(f.labelKey)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right panel - form. Below lg the branding collapses into a header
          above the card, on the same gradient as the wide layout. */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-5 py-12 sm:p-10">
        <div className="absolute inset-0 bg-gradient-to-b from-accent-amber/10 via-transparent to-transparent lg:hidden" />
        <div className="relative z-10 w-full max-w-[420px]">
          <div className="mb-8 flex flex-col items-center gap-4 text-center lg:hidden">
            <img src="/sirene.svg" alt="" className="size-16 rounded-2xl shadow-lg shadow-accent-amber/10" />
            <div className="space-y-1">
              <h2 className="font-serif text-2xl tracking-tight">{t('nav.appName')}</h2>
              <p className="text-sm text-muted-foreground">{t('auth.heroTitle')}</p>
            </div>
          </div>

          <Card className="border bg-bg-elevated/60 shadow-sm backdrop-blur">
            <CardContent className="p-6 sm:p-8">{children}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
