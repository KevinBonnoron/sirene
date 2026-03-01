import { eq, useLiveQuery } from '@tanstack/react-db';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generationCollection, voiceCollection } from '@/collections';
import { DeleteAllGenerationsButton } from '@/components/history/delete-all-generations-button';
import { GenerationCard } from '@/components/history/generation-card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const chipClass = 'rounded-full border px-3 py-1 text-xs font-medium transition-colors';
const chipActive = 'border-primary bg-primary text-primary-foreground';
const chipInactive = 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground';

export function HistoryPage() {
  const { t } = useTranslation();
  const { data: generations, isLoading } = useLiveQuery((q) => q.from({ g: generationCollection }).orderBy(({ g }) => g.created, 'desc'));

  const [voiceFilter, setVoiceFilter] = useState<string | null>(null);

  // Get unique voice IDs from generations
  const voiceIds = useMemo(() => {
    if (!generations) {
      return [];
    }
    return [...new Set(generations.map((g) => g.voice))];
  }, [generations]);

  // Fetch voices that appear in generations
  const { data: voices } = useLiveQuery(
    (q) =>
      q
        .from({ voices: voiceCollection })
        .where(({ voices }) => eq(voices.id, voices.id)), // get all, we filter client-side
  );

  // Build a voice name map
  const voiceMap = useMemo(() => {
    const map = new Map<string, string>();
    if (voices) {
      for (const v of voices) {
        map.set(v.id, v.name);
      }
    }
    return map;
  }, [voices]);

  // Voices that actually have generations, sorted by name
  const filterableVoices = useMemo(() => {
    return voiceIds
      .map((id) => ({ id, name: voiceMap.get(id) ?? t('voice.unknownVoice') }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [voiceIds, voiceMap, t]);

  const filteredGenerations = useMemo(() => {
    if (!generations) {
      return [];
    }
    if (!voiceFilter) {
      return generations;
    }
    return generations.filter((g) => g.voice === voiceFilter);
  }, [generations, voiceFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t('history.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('history.subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : generations?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
      ) : (
        <>
          {/* Voice filter chips */}
          {filterableVoices.length > 1 && (
            <div className="flex min-h-9 flex-wrap items-center gap-2">
              <button type="button" onClick={() => setVoiceFilter(null)} className={cn(chipClass, !voiceFilter ? chipActive : chipInactive)}>
                {t('voice.all')}
              </button>
              {filterableVoices.map((v) => (
                <button key={v.id} type="button" onClick={() => setVoiceFilter(voiceFilter === v.id ? null : v.id)} className={cn(chipClass, voiceFilter === v.id ? chipActive : chipInactive)}>
                  {v.name}
                </button>
              ))}
              {voiceFilter && filteredGenerations.length > 0 && (
                <div className="ml-auto">
                  <DeleteAllGenerationsButton
                    generationIds={filteredGenerations.map((g) => g.id)}
                    voiceName={voiceMap.get(voiceFilter) ?? t('voice.unknownVoice')}
                    onDeleted={() => setVoiceFilter(null)}
                  />
                </div>
              )}
            </div>
          )}

          {filteredGenerations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('history.noMatch')}</p>
          ) : (
            <div className="space-y-4">
              {filteredGenerations.map((gen) => (
                <GenerationCard key={gen.id} generation={gen} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
