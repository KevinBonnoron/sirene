import { useLiveQuery } from '@tanstack/react-db';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AudioLines, Box, Clock, Plus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { generationCollection, voiceCollection } from '@/collections';
import { GenerationCard } from '@/components/history/generation-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AddVoiceMenu } from '@/components/voice/voice-grid';
import { useModels } from '@/hooks/use-models';
import { useAuth } from '@/providers/auth-provider';

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

function StatCard({ icon: Icon, label, value, loading }: { icon: React.ElementType; label: string; value: number; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-16" /> : <p className="text-3xl font-bold">{value}</p>}
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { catalog, installations } = useModels();

  const { data: voices, isLoading: voicesLoading } = useLiveQuery((q) => q.from({ voices: voiceCollection }));
  const { data: generations, isLoading: generationsLoading } = useLiveQuery((q) => q.from({ g: generationCollection }).orderBy(({ g }) => g.created, 'desc'));

  const installedCount = installations?.filter((i) => i.status === 'installed').length ?? 0;
  const hasAnyModel = catalog.some((m) => !m.types.includes('transcription') && installations?.some((i) => i.id === m.id && i.status === 'installed'));
  const hasVoices = (voices?.length ?? 0) > 0;

  const recentGenerations = generations?.slice(0, 5) ?? [];

  const firstName = user?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? '';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t('dashboard.greeting', { name: firstName })}</h2>
        <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={AudioLines} label={t('dashboard.voices')} value={voices?.length ?? 0} loading={voicesLoading} />
        <StatCard icon={Clock} label={t('dashboard.generations')} value={generations?.length ?? 0} loading={generationsLoading} />
        <StatCard icon={Box} label={t('dashboard.modelsInstalled')} value={installedCount} loading={false} />
      </div>

      {/* CTAs */}
      {(!hasAnyModel || !hasVoices) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {!hasAnyModel && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-start gap-3 pt-6">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Box className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold">{t('dashboard.ctaModelTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('dashboard.ctaModelDesc')}</p>
                </div>
                <Button asChild size="sm">
                  <Link to="/models">{t('dashboard.ctaModelAction')}</Link>
                </Button>
              </CardContent>
            </Card>
          )}
          {hasAnyModel && !hasVoices && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-start gap-3 pt-6">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Sparkles className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold">{t('dashboard.ctaVoiceTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('dashboard.ctaVoiceDesc')}</p>
                </div>
                <AddVoiceMenu>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="size-4" />
                    {t('dashboard.ctaVoiceAction')}
                  </Button>
                </AddVoiceMenu>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Recent generations */}
      {recentGenerations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t('dashboard.recentGenerations')}</h3>
            <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground">
              <Link to="/history">{t('dashboard.viewAll')}</Link>
            </Button>
          </div>
          <div className="space-y-3">
            {recentGenerations.map((gen) => (
              <GenerationCard key={gen.id} generation={gen} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
