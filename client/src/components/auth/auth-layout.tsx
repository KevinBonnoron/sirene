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
      {/* Left panel — branding */}
      <div className="relative hidden overflow-hidden bg-muted lg:flex lg:w-1/2">
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
              {FEATURES.map((f) => (
                <div key={f.labelKey} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <f.icon className="size-4 text-primary" />
                  </div>
                  {t(f.labelKey)}
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground/50">
            {t('nav.appName')} — {t('nav.appSubtitle')}
          </p>
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
            <CardContent className="p-0 sm:p-8">{children}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
