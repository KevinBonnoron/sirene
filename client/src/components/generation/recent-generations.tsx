import { useLiveQuery } from '@tanstack/react-db';
import { useTranslation } from 'react-i18next';
import { generationCollection } from '@/collections';
import { GenerationCard } from '@/components/history/generation-card';
import { Skeleton } from '@/components/ui/skeleton';

export function RecentGenerations() {
  const { t } = useTranslation();
  const { data: generations, isLoading } = useLiveQuery((q) => q.from({ g: generationCollection }).orderBy(({ g }) => g.created, 'desc'));

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const recentGenerations = generations.slice(0, 5);
  if (recentGenerations.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('generate.noGenerations')}</p>;
  }

  return (
    <div className="space-y-2">
      {recentGenerations.map((generation) => (
        <GenerationCard key={generation.id} generation={generation} />
      ))}
    </div>
  );
}
