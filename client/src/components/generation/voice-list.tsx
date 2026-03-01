import type { Voice } from '@sirene/shared';
import { useVoiceFilters, VoiceFilterBar } from '@/components/voice/voice-filters';
import { VoiceGrid } from '@/components/voice/voice-grid';

interface Props {
  voices: Voice[] | undefined;
  voicesLoading: boolean;
  voiceId: string;
  onSelectVoice: (id: string) => void;
}

export function VoiceList({ voices, voicesLoading, voiceId, onSelectVoice }: Props) {
  const { filteredVoices, filterProps } = useVoiceFilters(voices);

  return (
    <div className="space-y-3">
      <VoiceFilterBar {...filterProps} />
      <VoiceGrid voices={filteredVoices} loading={voicesLoading} selectedId={voiceId} onSelect={onSelectVoice} empty={!voices?.length} />
    </div>
  );
}
