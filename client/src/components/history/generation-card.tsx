import type { Generation } from '@sirene/shared';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { useTranslation } from 'react-i18next';
import { voiceCollection } from '@/collections';
import { DeleteGenerationButton } from '@/components/generation/delete-generation-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Waveform } from '@/components/voice/waveform';
import { pb } from '@/lib/pocketbase';
import { formatRelative } from '@/utils/format-relative';
import { stripSSML } from '@/utils/ssml';

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
  const voiceName = voice?.name ?? t('voice.unknownVoice');
  const avatarUrl = voice?.avatar ? pb.files.getURL(voice, voice.avatar) : undefined;

  return (
    <article className="rounded-lg border border-border bg-card transition-colors">
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5 sm:gap-3 sm:px-4">
        <Avatar className="size-5 shrink-0">
          <AvatarImage src={avatarUrl} alt={voiceName} />
          <AvatarFallback className="text-[9px]">{voiceName.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="truncate text-xs font-medium">{voiceName}</span>
        <span className="text-xs text-dim">·</span>
        <span className="truncate text-xs text-muted-foreground">{generation.model}</span>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {generation.language}
        </Badge>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-dim">{formatRelative(generation.created, t)}</span>
        <DeleteGenerationButton generationId={generation.id} />
      </header>

      {generation.text && <p className="px-4 pt-3 font-serif text-[15px] leading-snug text-foreground/90 sm:px-5">{stripSSML(generation.text)}</p>}

      {generation.audio && (
        <div className="px-3 pb-2.5 pt-2 sm:px-4">
          <Waveform src={pb.files.getURL(generation, generation.audio)} autoPlay={autoPlay} />
        </div>
      )}
    </article>
  );
}
