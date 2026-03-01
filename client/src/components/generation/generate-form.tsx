import { useLiveQuery } from '@tanstack/react-db';
import { useEffect, useState } from 'react';
import { voiceCollection } from '@/collections';
import { Waveform } from '@/components/voice/waveform';
import { useGenerate } from '@/hooks/use-generate';
import { GenerationInput } from './generation-input';
import { VoiceList } from './voice-list';

export function GenerateForm() {
  const [voiceId, setVoiceId] = useState('');
  const { data: voices, isLoading: voicesLoading } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));
  const { generate, isGenerating, lastAudioBlob } = useGenerate();

  useEffect(() => {
    if (!voiceId && voices?.length) {
      setVoiceId(voices[0].id);
    }
  }, [voiceId, voices]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="custom-scrollbar -mx-6 min-h-0 flex-1 overflow-y-auto px-6">
        <VoiceList voices={voices} voicesLoading={voicesLoading} voiceId={voiceId} onSelectVoice={setVoiceId} />
      </div>
      <div className="-mx-6 -mb-6 shrink-0 space-y-3 bg-background px-6 py-4">
        {lastAudioBlob && <Waveform src={lastAudioBlob} autoPlay />}
        <GenerationInput voiceId={voiceId} generate={generate} isGenerating={isGenerating} />
      </div>
    </div>
  );
}
