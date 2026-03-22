import type { Voice } from '@sirene/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { VoiceFilterBar } from '@/components/voice/voice-filters';
import { useVoiceFilters } from '@/hooks/use-voice-filters';
import { VoiceGrid } from '@/components/voice/voice-grid';
import { Skeleton } from '../ui/skeleton';

interface Props {
  voices: Voice[] | undefined;
  voicesLoading: boolean;
  voiceId: string;
  onSelectVoice: (id: string) => void;
  showAddButton?: boolean;
  showManageLink?: boolean;
  editOnClick?: boolean;
}

export function VoiceList({ voices, voicesLoading, voiceId, onSelectVoice, showAddButton = true, showManageLink = false, editOnClick }: Props) {
  const { t } = useTranslation();
  const { filteredVoices, filterProps } = useVoiceFilters(voices);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <VoiceFilterBar {...filterProps} />
        </div>
        {showManageLink && (
          <Link to="/voices" className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {t('voice.manage')} →
          </Link>
        )}
      </div>

      {voicesLoading ? (
        <>
          {/* Mobile skeletons */}
          <div className="flex gap-3 md:hidden">
            {['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => (
              <Skeleton key={id} className="size-12 rounded-full" />
            ))}
          </div>
          {/* Tablet skeletons */}
          <div className="hidden gap-2 md:grid md:grid-cols-4 lg:hidden">
            {['t1', 't2', 't3', 't4'].map((id) => (
              <Skeleton key={id} className="h-14 rounded-lg" />
            ))}
          </div>
          {/* Desktop skeletons */}
          <div className="hidden gap-4 lg:grid lg:grid-cols-3">
            {['d1', 'd2', 'd3'].map((id) => (
              <Skeleton key={id} className="h-24 rounded-xl" />
            ))}
          </div>
        </>
      ) : (
        <VoiceGrid voices={filteredVoices} selectedId={voiceId} onSelect={onSelectVoice} empty={!voices?.length} showAddButton={showAddButton} editOnClick={editOnClick} />
      )}
    </div>
  );
}
