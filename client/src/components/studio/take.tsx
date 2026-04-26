import { type GenerationAlignment, hasPerWordTuning, type VoiceCapabilities } from '@sirene/shared';
import type { Editor, JSONContent } from '@tiptap/core';
import { AudioWaveform, Clock, Loader2, Pause, Play, RotateCw, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { generationClient } from '@/clients/generation.client';
import { Button } from '@/components/ui/button';
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
  /** Disables the generate/regenerate button even when this take isn't the one being generated (e.g. another generation is in flight). */
  disabled?: boolean;
  /** Tuning capabilities for the take's current voice/model. Drives slider availability. */
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
  // Single panel that toggles open/closed. Starts in "quick" (3 sliders); user can escalate
  // to "detailed" (per-word timeline) via the Mot button inside QuickTuning.
  const [affinageMode, setAffinageMode] = useState<AffinageMode | null>(null);
  const [alignment, setAlignment] = useState<GenerationAlignment | null>(null);
  const [alignLoading, setAlignLoading] = useState(false);
  const { isPlaying, progress, toggle } = useAudioPlayback(take.audioUrl);
  const editorRef = useRef<TakeEditorHandle>(null);
  const [activeMarks, setActiveMarks] = useState<ActiveMarks>(NO_ACTIVE_MARKS);

  // Local tuning draft — changes are uncommitted until regenerate. We reset only when the
  // underlying generation id swaps (i.e. a new row landed in this slot). Watching `take.tuning`
  // reference would clobber slider edits on every parent re-render, since `generationToTake`
  // returns a fresh object each time.
  const [localTuning, setLocalTuning] = useState<TakeTuning>(take.tuning);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on take.id only
  useEffect(() => {
    setLocalTuning(take.tuning);
  }, [take.id]);

  const badge = STATE_BADGE[take.state];
  const isDraft = take.state === 'draft';
  const isPanelOpen = affinageMode !== null;
  const canEditPerWord = hasPerWordTuning(capabilities);

  // If we're sitting on the detailed tab but the current voice no longer supports any per-word
  // editing (e.g. user just swapped to a more limited backend), fall back to the global tab.
  useEffect(() => {
    if (affinageMode === 'detailed' && !canEditPerWord) {
      setAffinageMode('quick');
    }
  }, [affinageMode, canEditPerWord]);

  // When the underlying generation is swapped (regenerate replaces the id at this slot),
  // drop the cached alignment so the timeline re-fetches against the new audio.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on take.id changes
  useEffect(() => {
    setAlignment(null);
    setAlignLoading(false);
  }, [take.id]);

  // Lazy-load alignment when the detailed timeline opens
  useEffect(() => {
    if (affinageMode !== 'detailed' || alignment || alignLoading || isDraft) {
      return;
    }
    setAlignLoading(true);
    generationClient
      .align(take.id)
      .then((res) => setAlignment(res))
      .catch((err) => toast.error(err instanceof Error ? err.message : t('studio.failedToLoadAlignment')))
      .finally(() => setAlignLoading(false));
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
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5 sm:gap-3 sm:px-4">
        <span className="shrink-0 font-mono text-[10.5px] text-dim tabular-nums">#{String(take.orderIndex).padStart(2, '0')}</span>

        <TakeVoicePicker voiceId={take.voiceId} onChange={onVoiceChange ?? (() => {})} disabled={!onVoiceChange} />

        {/* State + duration (inline, no border) */}
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <span className={cn('flex items-center gap-1.5 text-[11px]', badge.textClass)}>
            <span className={cn('size-1.5 rounded-full', badge.dotClass)} />
            {t(badge.labelKey)}
          </span>
          {!isDraft && totalDuration > 0 && <span className="font-mono text-[10.5px] text-dim tabular-nums">{formatTime(totalDuration)}</span>}
        </div>

        {/* Affinage toggle — opens in 'quick' mode, can escalate to 'detailed' from inside the panel */}
        {!isDraft && (
          <button
            type="button"
            onClick={() => setAffinageMode((m) => (m ? null : 'quick'))}
            aria-label={t('studio.tuning')}
            aria-pressed={isPanelOpen}
            className={cn('flex shrink-0 items-center gap-1.5 rounded transition-colors', isPanelOpen ? 'border border-accent-violet/40 bg-accent-violet/15 px-2 py-1 text-[11px] text-accent-violet' : 'size-7 justify-center text-muted-foreground hover:bg-muted/40 hover:text-foreground')}
          >
            <AudioWaveform className="size-3.5" />
            {isPanelOpen && <span className="hidden sm:inline">{t('studio.tuning')}</span>}
          </button>
        )}
      </header>

      {/* Body */}
      <div className="px-4 pt-3 pb-2 sm:px-5">
        <TakeEditor ref={editorRef} key={take.id} initialContent={take.content} editable={isDraft && !isGenerating} placeholder={isDraft ? t('studio.composerPlaceholder') : ''} onChange={onContentChange} onActiveChange={setActiveMarks} onSubmit={onGenerate} className={isDraft ? 'min-h-[34px]' : ''} />
      </div>

      {/* Transport — play button + waveform + time (no top border, body flows into transport).
          When the take is regenerating, pulse the row to signal the audio about to be replaced. */}
      {!isDraft && (
        <div className={cn('flex items-center gap-3 px-4 pb-2.5 pt-1 sm:px-5', isGenerating && 'animate-pulse')}>
          <Button variant="ghost" size="icon" disabled={!take.audioUrl || isGenerating} className="size-8 shrink-0 rounded-full bg-bg-elevated hover:bg-card-elevated" onClick={toggle} aria-label={isPlaying ? t('studio.pause') : t('studio.play')}>
            {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-[1px]" />}
          </Button>
          <TakeWaveform seed={take.orderIndex * 17 + 1} active={isPlaying} progress={progress} className="min-w-0 flex-1 overflow-hidden" />
          {/* Always show "current / total" — preserves the pause position, resets to 0:00 once
              the audio ends (handled by the audio playback hook). */}
          <span className="shrink-0 font-mono text-[10.5px] text-dim tabular-nums">{`${formatTime(playPosition)} / ${formatTime(totalDuration)}`}</span>
        </div>
      )}

      {/* Affinage panel — segmented header (Global / Par mot) + active mode below */}
      {!isDraft && isPanelOpen && (
        <div className="border-t border-border-subtle bg-bg-elevated">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2 sm:px-5">
            <span className="text-xs text-muted-foreground">{t('studio.tuning')}</span>
            <div role="tablist" aria-label={t('studio.tuning')} className="flex items-center rounded border border-border-subtle bg-card p-0.5 text-[10.5px]">
              <button
                type="button"
                role="tab"
                aria-selected={affinageMode === 'quick'}
                onClick={() => setAffinageMode('quick')}
                className={cn('flex items-center gap-1.5 rounded-sm px-2 py-0.5 transition-colors', affinageMode === 'quick' ? 'bg-bg-elevated text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <SlidersHorizontal className="size-3" />
                {t('studio.tuningGlobal')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={affinageMode === 'detailed'}
                disabled={!canEditPerWord}
                title={canEditPerWord ? undefined : t('studio.tuningUnsupported')}
                onClick={() => setAffinageMode('detailed')}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-2 py-0.5 transition-colors',
                  !canEditPerWord && 'cursor-not-allowed opacity-50',
                  canEditPerWord && (affinageMode === 'detailed' ? 'bg-accent-violet/15 text-accent-violet' : 'text-muted-foreground hover:text-foreground'),
                  !canEditPerWord && 'text-dim',
                )}
              >
                <AudioWaveform className="size-3" />
                {t('studio.tuningPerWord')}
              </button>
            </div>
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

      {/* Actions */}
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

  const ghostBtn = 'flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50';
  // Active styling: tinted background + ring in the button's accent colour, mirroring the chip
  // colour the user sees in the editor. Keeps the relationship "this button = this chip" obvious.
  const activeSky = 'bg-accent-sky/15 ring-1 ring-inset ring-accent-sky/40';
  const activeRust = 'bg-accent-rust/15 ring-1 ring-inset ring-accent-rust/40';
  const activeSage = 'bg-accent-sage/15 ring-1 ring-inset ring-accent-sage/40';

  // SSML mark buttons need to fire on mousedown (with preventDefault) so the editor doesn't
  // lose focus / collapse its selection before the mark is applied. onClick fires *after* the
  // blur, by which point the selection is gone and Tiptap silently no-ops.
  return (
    <>
      <button
        type="button"
        disabled={isBusy}
        onMouseDown={(e) => {
          e.preventDefault();
          onInsertEffect('pause', t('generate.effectPause'));
        }}
        className={cn(ghostBtn, 'text-muted-foreground hover:text-foreground')}
      >
        <Clock className="size-3" />
        {t('studio.toolbarPause')}
      </button>
      <button
        type="button"
        disabled={isBusy}
        aria-pressed={activeMarks.slow}
        onMouseDown={(e) => {
          e.preventDefault();
          onToggleSpeed(0.75);
        }}
        className={cn(ghostBtn, 'text-accent-sky', activeMarks.slow && activeSky)}
      >
        {t('studio.toolbarSlow')}
      </button>
      <button
        type="button"
        disabled={isBusy}
        aria-pressed={activeMarks.fast}
        onMouseDown={(e) => {
          e.preventDefault();
          onToggleSpeed(1.25);
        }}
        className={cn(ghostBtn, 'text-accent-rust', activeMarks.fast && activeRust)}
      >
        {t('studio.toolbarFast')}
      </button>
      <button
        type="button"
        disabled={isBusy}
        aria-pressed={activeMarks.emphasis}
        onMouseDown={(e) => {
          e.preventDefault();
          onToggleTone('emphasis');
        }}
        className={cn(ghostBtn, 'text-accent-sage', activeMarks.emphasis && activeSage)}
      >
        {t('studio.toolbarEmphasis')}
      </button>

      <div className="ml-auto flex items-center gap-2">
        {estimatedLabel && <span className="hidden font-mono text-[10.5px] tabular-nums text-dim sm:inline">{estimatedLabel}</span>}
        <Button size="sm" disabled={isBusy} className="gap-1.5 bg-accent-amber text-bg-elevated hover:bg-accent-amber/90" onClick={onGenerate}>
          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {t('studio.generate')}
          <span className="ml-1 hidden font-mono text-[10px] opacity-70 sm:inline">⌘↵</span>
        </Button>
      </div>
    </>
  );
}
