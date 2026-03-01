import type { Generation } from '@sirene/shared';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { useTranslation } from 'react-i18next';
import { voiceCollection } from '@/collections';
import { DeleteGenerationButton } from '@/components/generation/delete-generation-button';
import { Badge } from '@/components/ui/badge';
import { Waveform } from '@/components/voice/waveform';
import { pb } from '@/lib/pocketbase';

interface Props {
  generation: Pick<Generation, 'id' | 'voice' | 'model' | 'text' | 'audio' | 'language' | 'created'>;
  autoPlay?: boolean;
}

export function GenerationCard({ generation, autoPlay }: Props) {
  const { t } = useTranslation();
  const { data: voice } = useLiveQuery((q) =>
    q
      .from({ voices: voiceCollection })
      .where(({ voices }) => eq(voices.id, generation.voice))
      .findOne(),
  );

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{voice?.name ?? t('voice.unknownVoice')}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {generation.model}
          </Badge>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {generation.language}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{new Date(generation.created).toLocaleString()}</span>
          <DeleteGenerationButton generationId={generation.id} />
        </div>
      </div>
      {generation.audio && <Waveform src={pb.files.getURL(generation, generation.audio)} autoPlay={autoPlay} />}
      {generation.text && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{generation.text}</p>}
    </div>
  );
}
