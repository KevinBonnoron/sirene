import type { Editor, JSONContent } from '@tiptap/core';
import { Loader2, MoreHorizontal, Pause, Play, RotateCw, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAudioPlayback } from '@/hooks/use-audio-playback';
import { cn } from '@/lib/utils';
import { TakeEditor } from './take-editor';
import { TakeQuickTuning } from './take-quick-tuning';
import { TakeVoicePicker } from './take-voice-picker';
import { TakeWaveform } from './take-waveform';

export type TakeState = 'draft' | 'ready' | 'tuned';

export interface TakeTuning {
  pitchShift: number;
  speedMultiplier: number;
  variationSeed: number;
}

export interface TakeData {
  id: string;
  orderIndex: number;
  state: TakeState;
  voiceId: string;
  content: JSONContent;
  duration?: number;
  tuning: TakeTuning;
  audioUrl?: string;
}

interface Props {
  take: TakeData;
  isFocused?: boolean;
  isGenerating?: boolean;
  onContentChange?: (editor: Editor) => void;
  onVoiceChange?: (voiceId: string) => void;
  onGenerate?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  onTuningChange?: (tuning: TakeTuning) => void;
}

const STATE_BADGE: Record<TakeState, { labelKey: string; dot: string }> = {
  draft: { labelKey: 'studio.stateDraft', dot: 'bg-dim' },
  ready: { labelKey: 'studio.stateReady', dot: 'bg-accent-sage' },
  tuned: { labelKey: 'studio.stateTuned', dot: 'bg-accent-violet' },
};

function formatDuration(seconds?: number): string {
  if (!seconds) {
    return '—';
  }
  const total = Math.round(seconds * 10) / 10;
  if (total < 60) {
    return `${total.toFixed(1)}s`;
  }
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Take({ take, isFocused, isGenerating, onContentChange, onVoiceChange, onGenerate, onRegenerate, onDelete, onTuningChange }: Props) {
  const { t } = useTranslation();
  const [tuningOpen, setTuningOpen] = useState(false);
  const { isPlaying, progress, toggle } = useAudioPlayback(take.audioUrl);
  const badge = STATE_BADGE[take.state];

  const isDraft = take.state === 'draft';

  return (
    <article className={cn('group relative rounded-lg border bg-card transition-colors', isFocused ? 'border-accent-amber/50 shadow-[0_0_0_1px_var(--accent-amber)/20]' : 'border-border', isDraft && 'bg-bg-elevated')}>
      {/* Header */}
      <header className="flex items-center gap-2 px-3 pt-3 pb-2 sm:gap-3 sm:px-4">
        <span className="shrink-0 font-mono text-xs text-dim tabular-nums">#{String(take.orderIndex).padStart(2, '0')}</span>

        <TakeVoicePicker voiceId={take.voiceId} onChange={onVoiceChange ?? (() => {})} disabled={!onVoiceChange} />

        <Badge variant="outline" className="ml-auto shrink-0 gap-1.5 border-border-subtle px-2 py-0 text-[10px] font-normal">
          <span className={cn('size-1.5 rounded-full', badge.dot)} />
          {t(badge.labelKey)}
        </Badge>

        <span className="hidden shrink-0 font-mono text-xs text-dim tabular-nums sm:inline">{formatDuration(take.duration)}</span>

        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="size-3.5" />
        </Button>
      </header>

      {/* Body */}
      <div className="px-3 pb-3 sm:px-4">
        <TakeEditor key={take.id} initialContent={take.content} editable={isDraft && !isGenerating} placeholder={isDraft ? t('studio.composerPlaceholder') : ''} onChange={onContentChange} onSubmit={onGenerate} className="min-h-[56px]" />
      </div>

      {/* Transport + waveform (ready/tuned) */}
      {!isDraft && (
        <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2.5 sm:gap-3 sm:px-4">
          <Button variant="ghost" size="icon" disabled={!take.audioUrl} className="size-8 shrink-0 rounded-full bg-bg-elevated hover:bg-card-elevated" onClick={toggle} aria-label={isPlaying ? t('studio.pause') : t('studio.play')}>
            {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-[1px]" />}
          </Button>
          <TakeWaveform seed={take.orderIndex * 17 + 1} active={isPlaying} progress={progress} className="min-w-0 flex-1 overflow-hidden" />
          <button
            type="button"
            onClick={() => setTuningOpen((o) => !o)}
            aria-label={t('studio.tuning')}
            aria-pressed={tuningOpen}
            className={cn('flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors', tuningOpen ? 'bg-card-elevated text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            <SlidersHorizontal className="size-3.5" />
            <span className="hidden sm:inline">{t('studio.tuning')}</span>
          </button>
        </div>
      )}

      {/* Quick tuning (collapsible) */}
      {!isDraft && tuningOpen && <TakeQuickTuning tuning={take.tuning} onChange={onTuningChange ?? (() => {})} onRegenerate={onRegenerate ?? (() => {})} />}

      {/* Actions */}
      <footer className="flex items-center gap-2 border-t border-border-subtle px-3 py-2 sm:px-4">
        {isDraft ? (
          <>
            <Button size="sm" disabled={isGenerating} className="gap-1.5 bg-accent-amber text-bg-elevated hover:bg-accent-amber/90" onClick={onGenerate}>
              {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {t('studio.generate')}
              <span className="ml-1 hidden font-mono text-[10px] opacity-70 sm:inline">⌘↵</span>
            </Button>
            <span className="hidden text-xs text-muted-foreground sm:inline">{t('studio.draftHint')}</span>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" disabled={isGenerating} className="gap-1.5" onClick={onRegenerate}>
              {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
              <span className="hidden sm:inline">{t('studio.regenerate')}</span>
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto gap-1.5 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label={t('common.delete')}>
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </footer>
    </article>
  );
}
