import { type GenerationAlignment, hasPerWordTuning, type VoiceCapabilities } from '@sirene/shared';
import type { Editor, JSONContent } from '@tiptap/core';
import { AudioWaveform, Clock, Loader2, Pause, Play, RotateCw, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { generationClient } from '@/clients/generation.client';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAudioPlayback } from '@/hooks/use-audio-playback';
import { cn } from '@/lib/utils';
import { countWords, estimateSpeechDuration } from '@/utils/ssml';
import { type PitchPoint, ProsodyTimeline } from './prosody-timeline';
import { type ActiveMarks, TakeEditor, type TakeEditorHandle } from './take-editor';
import { TakeQuickTuning } from './take-quick-tuning';
import { TakeVoicePicker } from './take-voice-picker';
import { TakeWaveform } from './take-waveform';

const NO_ACTIVE_MARKS: ActiveMarks = { slow: false, fast: false, emphasis: false };

export type TakeState = 'draft' | 'ready' | 'tuned';

export interface TakeTuning {
  pitchShift: number;
  speedMultiplier: number;
  variationSeed: number;
  prosodyCurve?: PitchPoint[];
  wordRates?: Record<string, number>;
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
  disabled?: boolean;
  capabilities: VoiceCapabilities;
  onContentChange?: (editor: Editor) => void;
  onVoiceChange?: (voiceId: string) => void;
  onGenerate?: () => void;
  onRegenerate?: (tuning: TakeTuning) => void;
  onDelete?: () => void;
}

const STATE_BADGE: Record<TakeState, { labelKey: string; dotClass: string; textClass: string }> = {
  draft: { labelKey: 'studio.stateDraft', dotClass: 'bg-dim', textClass: 'text-dim' },
  ready: { labelKey: 'studio.stateReady', dotClass: 'bg-accent-sage', textClass: 'text-accent-sage' },
  tuned: { labelKey: 'studio.stateTuned', dotClass: 'bg-accent-violet', textClass: 'text-accent-violet' },
};

function formatTime(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) {
    return '0:00';
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type AffinageMode = 'quick' | 'detailed';

export function Take({ take, isFocused, isGenerating, disabled, capabilities, onContentChange, onVoiceChange, onGenerate, onRegenerate, onDelete }: Props) {
  const { t } = useTranslation();
  const [affinageMode, setAffinageMode] = useState<AffinageMode | null>(null);
  const [alignment, setAlignment] = useState<GenerationAlignment | null>(null);
  const [alignLoading, setAlignLoading] = useState(false);
  const { isPlaying, progress, toggle } = useAudioPlayback(take.audioUrl);
  const editorRef = useRef<TakeEditorHandle>(null);
  const [activeMarks, setActiveMarks] = useState<ActiveMarks>(NO_ACTIVE_MARKS);

  const [localTuning, setLocalTuning] = useState<TakeTuning>(take.tuning);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on take.id only
  useEffect(() => {
    setLocalTuning(take.tuning);
  }, [take.id]);

  const badge = STATE_BADGE[take.state];
  const isDraft = take.state === 'draft';
  const isPanelOpen = affinageMode !== null;
  const canEditPerWord = hasPerWordTuning(capabilities);

  useEffect(() => {
    if (affinageMode === 'detailed' && !canEditPerWord) {
      setAffinageMode('quick');
    }
  }, [affinageMode, canEditPerWord]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on take.id only
  useEffect(() => {
    setAlignment(null);
    setAlignLoading(false);
  }, [take.id]);

  useEffect(() => {
    if (affinageMode !== 'detailed' || alignment || alignLoading || isDraft) {
      return;
    }
    let cancelled = false;
    setAlignLoading(true);
    generationClient
      .align(take.id)
      .then((res) => {
        if (!cancelled) {
          setAlignment(res);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : t('studio.failedToLoadAlignment'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAlignLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [affinageMode, alignment, alignLoading, isDraft, take.id, t]);

  const handlePitchCurveChange = useCallback((prosodyCurve: PitchPoint[]) => {
    setLocalTuning((prev) => ({ ...prev, prosodyCurve }));
  }, []);

  const handleWordRateChange = useCallback((wordIndex: number, rate: number) => {
    setLocalTuning((prev) => ({
      ...prev,
      wordRates: { ...(prev.wordRates ?? {}), [String(wordIndex)]: rate },
    }));
  }, []);

  const handleRegenerateClick = useCallback(() => {
    onRegenerate?.(localTuning);
  }, [onRegenerate, localTuning]);

  const totalDuration = take.duration ?? 0;
  const playPosition = totalDuration * progress;

  return (
    <article
      className={cn(
        'group relative rounded-lg border bg-card transition-colors',
        isFocused ? 'border-accent-amber/50 shadow-[0_0_0_1px_var(--accent-amber)/20]' : 'border-border',
        isDraft && 'bg-bg-elevated',
        affinageMode === 'detailed' && 'border-accent-violet/40 shadow-[0_0_0_1px_color-mix(in_oklch,var(--accent-violet)_30%,transparent)]',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5 sm:gap-3 sm:px-4">
        <span className="shrink-0 font-mono text-[10.5px] text-dim tabular-nums">#{String(take.orderIndex).padStart(2, '0')}</span>

        <TakeVoicePicker voiceId={take.voiceId} onChange={onVoiceChange ?? (() => {})} disabled={!onVoiceChange} />

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <span className={cn('flex items-center gap-1.5 text-[11px]', badge.textClass)}>
            <span className={cn('size-1.5 rounded-full', badge.dotClass)} />
            {t(badge.labelKey)}
          </span>
          {!isDraft && totalDuration > 0 && <span className="font-mono text-[10.5px] text-dim tabular-nums">{formatTime(totalDuration)}</span>}
        </div>

        {!isDraft && (
          <Toggle
            size="sm"
            pressed={isPanelOpen}
            onPressedChange={(pressed) => setAffinageMode(pressed ? 'quick' : null)}
            aria-label={t('studio.tuning')}
            className={cn('shrink-0 text-muted-foreground', isPanelOpen ? 'data-[state=on]:bg-accent-violet/15 data-[state=on]:text-accent-violet data-[state=on]:border data-[state=on]:border-accent-violet/40' : 'size-7 min-w-7 px-0')}
          >
            <AudioWaveform className="size-3.5" />
            {isPanelOpen && <span className="hidden text-[11px] sm:inline">{t('studio.tuning')}</span>}
          </Toggle>
        )}
      </header>

      <div className="px-4 pt-3 pb-2 sm:px-5">
        <TakeEditor ref={editorRef} key={take.id} initialContent={take.content} editable={isDraft && !isGenerating} placeholder={isDraft ? t('studio.composerPlaceholder') : ''} onChange={onContentChange} onActiveChange={setActiveMarks} onSubmit={onGenerate} className={isDraft ? 'min-h-[34px]' : ''} />
      </div>

      {!isDraft && (
        <div className={cn('flex items-center gap-3 px-4 pb-2.5 pt-1 sm:px-5', isGenerating && 'animate-pulse')}>
          <Button variant="ghost" size="icon" disabled={!take.audioUrl || isGenerating} className="size-8 shrink-0 rounded-full bg-bg-elevated hover:bg-accent-amber hover:text-primary-foreground" onClick={toggle} aria-label={isPlaying ? t('studio.pause') : t('studio.play')}>
            {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-[1px]" />}
          </Button>
          <TakeWaveform seed={take.orderIndex * 17 + 1} active={isPlaying} progress={progress} ariaLabel={t('studio.waveformAriaLabel')} className="min-w-0 flex-1 overflow-hidden" />
          <span className="shrink-0 font-mono text-[10.5px] text-dim tabular-nums">{`${formatTime(playPosition)} / ${formatTime(totalDuration)}`}</span>
        </div>
      )}

      {!isDraft && isPanelOpen && (
        <div className="border-t border-border-subtle bg-bg-elevated">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2 sm:px-5">
            <span className="text-xs text-muted-foreground">{t('studio.tuning')}</span>
            <ToggleGroup
              type="single"
              value={affinageMode ?? ''}
              onValueChange={(v: string) => {
                if (v === 'quick' || v === 'detailed') {
                  setAffinageMode(v);
                }
              }}
              variant="outline"
              size="sm"
              aria-label={t('studio.tuning')}
              className="text-[10.5px]"
            >
              <ToggleGroupItem value="quick" aria-label={t('studio.tuningGlobal')}>
                <SlidersHorizontal className="size-3" />
                {t('studio.tuningGlobal')}
              </ToggleGroupItem>
              <ToggleGroupItem value="detailed" disabled={!canEditPerWord} title={canEditPerWord ? undefined : t('studio.tuningUnsupported')} aria-label={t('studio.tuningPerWord')} className="data-[state=on]:bg-accent-violet/15 data-[state=on]:text-accent-violet">
                <AudioWaveform className="size-3" />
                {t('studio.tuningPerWord')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {affinageMode === 'quick' ? (
            <TakeQuickTuning tuning={localTuning} capabilities={capabilities} onChange={setLocalTuning} />
          ) : (
            <ProsodyTimeline
              duration={alignment?.duration ?? take.duration ?? 0}
              words={alignment?.words ?? []}
              pitchCurve={localTuning.prosodyCurve ?? []}
              wordRates={localTuning.wordRates ?? {}}
              capabilities={capabilities}
              isLoading={alignLoading}
              onPitchCurveChange={handlePitchCurveChange}
              onWordRateChange={handleWordRateChange}
            />
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2 sm:px-4">
        {isDraft ? (
          <DraftToolbar
            content={take.content}
            speedMultiplier={localTuning.speedMultiplier}
            isBusy={Boolean(isGenerating || disabled)}
            activeMarks={activeMarks}
            onInsertEffect={(effect, label) => editorRef.current?.insertEffect(effect, label)}
            onToggleSpeed={(rate) => editorRef.current?.toggleSpeed(rate)}
            onToggleTone={(tone) => editorRef.current?.toggleTone(tone)}
            onGenerate={onGenerate}
          />
        ) : (
          <>
            <Button size="sm" variant="outline" disabled={isGenerating || disabled} className="gap-1.5" onClick={handleRegenerateClick}>
              {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
              <span className="hidden sm:inline">{t('studio.regenerate')}</span>
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} className="ml-auto gap-1.5 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label={t('common.delete')}>
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </footer>
    </article>
  );
}

interface DraftToolbarProps {
  content: JSONContent;
  speedMultiplier: number;
  isBusy: boolean;
  activeMarks: ActiveMarks;
  onInsertEffect: (effect: string, label?: string) => void;
  onToggleSpeed: (rate: number) => void;
  onToggleTone: (tone: string) => void;
  onGenerate?: () => void;
}

function DraftToolbar({ content, speedMultiplier, isBusy, activeMarks, onInsertEffect, onToggleSpeed, onToggleTone, onGenerate }: DraftToolbarProps) {
  const { t } = useTranslation();
  const wordCount = countWords(content);
  const estimated = estimateSpeechDuration(wordCount, speedMultiplier);
  const estimatedLabel = wordCount === 0 ? '' : `${wordCount} ${t(wordCount === 1 ? 'studio.wordCountSingular' : 'studio.wordCountPlural')} · ~${formatTime(estimated)}`;

  // Keep the editor's selection alive while clicking — the click handler runs after, with the
  // selection still active, so setMark / insertContent target the right range.
  const preventEditorBlur = (e: React.MouseEvent) => e.preventDefault();

  return (
    <>
      <Button type="button" size="sm" variant="ghost" disabled={isBusy} onMouseDown={preventEditorBlur} onClick={() => onInsertEffect('pause', t('generate.effectPause'))} className="text-muted-foreground">
        <Clock className="size-3" />
        {t('studio.toolbarPause')}
      </Button>
      <Toggle
        size="sm"
        pressed={activeMarks.slow}
        disabled={isBusy}
        onMouseDown={preventEditorBlur}
        onPressedChange={() => onToggleSpeed(0.75)}
        className="text-accent-sky hover:bg-accent-sky/10 hover:text-accent-sky data-[state=on]:bg-accent-sky/15 data-[state=on]:text-accent-sky data-[state=on]:ring-1 data-[state=on]:ring-inset data-[state=on]:ring-accent-sky/40"
      >
        {t('studio.toolbarSlow')}
      </Toggle>
      <Toggle
        size="sm"
        pressed={activeMarks.fast}
        disabled={isBusy}
        onMouseDown={preventEditorBlur}
        onPressedChange={() => onToggleSpeed(1.25)}
        className="text-accent-rust hover:bg-accent-rust/10 hover:text-accent-rust data-[state=on]:bg-accent-rust/15 data-[state=on]:text-accent-rust data-[state=on]:ring-1 data-[state=on]:ring-inset data-[state=on]:ring-accent-rust/40"
      >
        {t('studio.toolbarFast')}
      </Toggle>
      <Toggle
        size="sm"
        pressed={activeMarks.emphasis}
        disabled={isBusy}
        onMouseDown={preventEditorBlur}
        onPressedChange={() => onToggleTone('emphasis')}
        className="text-accent-sage hover:bg-accent-sage/10 hover:text-accent-sage data-[state=on]:bg-accent-sage/15 data-[state=on]:text-accent-sage data-[state=on]:ring-1 data-[state=on]:ring-inset data-[state=on]:ring-accent-sage/40"
      >
        {t('studio.toolbarEmphasis')}
      </Toggle>

      <div className="ml-auto flex items-center gap-2">
        {estimatedLabel && <span className="hidden font-mono text-[10.5px] tabular-nums text-dim sm:inline">{estimatedLabel}</span>}
        <Button size="sm" disabled={isBusy} className="gap-1.5 bg-accent-amber text-primary-foreground hover:bg-accent-amber/90" onClick={onGenerate}>
          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {t('studio.generate')}
          <span className="ml-1 hidden font-mono text-[10px] opacity-70 sm:inline">⌘↵</span>
        </Button>
      </div>
    </>
  );
}
