import type { Voice } from '@sirene/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useVoiceFilters, VoiceFilterBar } from '@/components/voice/voice-filters';
import { VoiceGrid } from '@/components/voice/voice-grid';

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
      <VoiceGrid voices={filteredVoices} loading={voicesLoading} selectedId={voiceId} onSelect={onSelectVoice} empty={!voices?.length} showAddButton={showAddButton} editOnClick={editOnClick} />
    </div>
  );
}
