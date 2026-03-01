import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { VoiceSample } from '@sirene/shared';
import { AudioLines, Info, Loader2, Plus, X } from 'lucide-react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { voiceSampleCollection } from '@/collections';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Waveform } from '../waveform';
import { SortableSampleItem } from './sortable-sample-item';
import type { PendingSample } from './state';

interface Props {
  existingSamples?: VoiceSample[];
  pendingSamples: PendingSample[];
  cumulativeDurations: number[];
  totalDuration: number;
  maxReferenceDuration: number;
  sampleInputRef: RefObject<HTMLInputElement | null>;
  onDeleteSample: (id: string) => void;
  onRemovePending: (id: string) => void;
  onTranscriptChange: (id: string, transcript: string) => void;
  onTranscribe: (id: string) => void;
  onAddSamplesClick: () => void;
  onAddSampleFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function VoiceSampleSection({ existingSamples, pendingSamples, cumulativeDurations, totalDuration, maxReferenceDuration, sampleInputRef, onDeleteSample, onRemovePending, onTranscriptChange, onTranscribe, onAddSamplesClick, onAddSampleFiles }: Props) {
  const { t } = useTranslation();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !existingSamples) {
      return;
    }
    const oldIndex = existingSamples.findIndex((s) => s.id === active.id);
    const newIndex = existingSamples.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    const reordered = [...existingSamples];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    for (let i = 0; i < reordered.length; i++) {
      voiceSampleCollection.update(reordered[i].id, (draft) => {
        draft.order = i;
      });
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:min-h-0 sm:flex-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label>{t('voice.audioSamples')}</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-xs">
              {t('voice.audioSamplesHint')}
            </TooltipContent>
          </Tooltip>
        </div>
        {totalDuration > 0 && <span className="text-[10px] text-muted-foreground">{t('voice.totalDuration', { duration: totalDuration.toFixed(1), max: maxReferenceDuration })}</span>}
      </div>

      <div className="space-y-2 sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
        {existingSamples && existingSamples.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={existingSamples.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {existingSamples.map((sample, i) => (
                  <SortableSampleItem
                    key={sample.id}
                    sample={sample}
                    cumulativeDuration={cumulativeDurations[i]}
                    maxDuration={maxReferenceDuration}
                    onToggleEnabled={() =>
                      voiceSampleCollection.update(sample.id, (draft) => {
                        draft.enabled = sample.enabled === false;
                      })
                    }
                    onDelete={() => onDeleteSample(sample.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {pendingSamples.map((sample) => (
          <div key={sample.id} className="space-y-2 rounded-md border border-dashed p-2">
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-medium">{sample.file.name}</span>
              <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => onRemovePending(sample.id)}>
                <X className="size-3.5" />
              </Button>
            </div>
            <Waveform src={sample.file} height={32} />
            <div className="flex gap-1.5">
              <Textarea value={sample.transcript} onChange={(e) => onTranscriptChange(sample.id, e.target.value)} placeholder={t('voice.pendingTranscriptPlaceholder')} rows={1} className="min-h-0 flex-1 text-xs" />
              <Button type="button" variant="outline" size="icon" className="size-7 shrink-0" onClick={() => onTranscribe(sample.id)} disabled={sample.transcribing}>
                {sample.transcribing ? <Loader2 className="size-3 animate-spin" /> : <AudioLines className="size-3" />}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="w-full shrink-0" onClick={onAddSamplesClick}>
        <Plus className="size-3.5" />
        {t('voice.addAudioSample')}
      </Button>
      <input ref={sampleInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={onAddSampleFiles} />
    </div>
  );
}
