import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { VoiceSample } from '@sirene/shared';
import { GripVertical, Trash2, Volume2, VolumeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';
import { Waveform } from '../waveform';

function getDurationColor(cumulativeDuration: number, maxDuration: number) {
  if (cumulativeDuration > maxDuration) {
    return 'border-l-red-500';
  }

  if (cumulativeDuration > maxDuration * 0.8) {
    return 'border-l-amber-500';
  }

  return 'border-l-green-500';
}

interface Props {
  sample: VoiceSample;
  cumulativeDuration: number;
  maxDuration: number;
  onToggleEnabled: () => void;
  onDelete: () => void;
}

export function SortableSampleItem({ sample, cumulativeDuration, maxDuration, onToggleEnabled, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sample.id });
  const enabled = sample.enabled !== false;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn('space-y-1 rounded-md border border-l-4 p-2', enabled ? getDurationColor(cumulativeDuration, maxDuration) : 'border-l-muted', isDragging && 'opacity-50', !enabled && 'opacity-40')}>
      <div className="flex items-center gap-2">
        <button type="button" className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground" {...attributes} {...listeners}>
          <GripVertical className="size-3.5" />
        </button>
        <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground" onClick={onToggleEnabled}>
          {enabled ? <Volume2 className="size-3.5" /> : <VolumeOff className="size-3.5" />}
        </Button>
        <Waveform src={pb.files.getURL(sample, sample.audio)} height={32} />
        <span className="shrink-0 text-[10px] text-muted-foreground">{sample.duration ? `${sample.duration.toFixed(1)}s` : ''}</span>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {sample.transcript && <p className="line-clamp-1 pl-6 text-xs text-muted-foreground">{sample.transcript}</p>}
    </div>
  );
}
