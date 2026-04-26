import type { VoiceCapabilities, WordAlignment } from '@sirene/shared';
import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type PitchPoint = [time: number, pitch: number]; // both normalized 0..1

interface Props {
  duration: number;
  words: WordAlignment[];
  pitchCurve: PitchPoint[]; // normalized 0..1 / 0..1 (0.5 = neutral)
  wordRates: Record<string, number>;
  capabilities: VoiceCapabilities;
  isLoading?: boolean;
  onPitchCurveChange: (curve: PitchPoint[]) => void;
  onWordRateChange: (wordIndex: number, rate: number) => void;
}

const PITCH_LANE_HEIGHT = 70;
const WORD_LANE_HEIGHT = 36;
const SPEED_LANE_HEIGHT = 40;
const LABEL_COL_WIDTH = 72;

const MIN_RATE = 0.5;
const MAX_RATE = 1.5;
const MAX_PITCH_POINTS = 8;
const PITCH_INSET = 0.04;

function makeDefaultCurve(wordCount: number): PitchPoint[] {
  if (wordCount < 2) {
    return [];
  }
  const n = Math.min(MAX_PITCH_POINTS, wordCount);
  return Array.from({ length: n }, (_, i) => [PITCH_INSET + (i / (n - 1)) * (1 - 2 * PITCH_INSET), 0.5] as PitchPoint);
}

function pitchCurveToPath(curve: PitchPoint[], width: number, height: number): string {
  if (curve.length < 2) {
    return '';
  }
  const pts = curve.map(([t, p]) => [t * width, (1 - p) * height] as const);
  const first = pts[0];
  let d = `M ${first[0]} ${first[1]}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const midX = (prev[0] + curr[0]) / 2;
    d += ` C ${midX} ${prev[1]}, ${midX} ${curr[1]}, ${curr[0]} ${curr[1]}`;
  }
  return d;
}

function pitchCurveToAreaPath(curve: PitchPoint[], width: number, height: number): string {
  const line = pitchCurveToPath(curve, width, height);
  if (!line) {
    return '';
  }
  const last = curve[curve.length - 1];
  return `${line} L ${last[0] * width} ${height} L 0 ${height} Z`;
}

interface LaneProps {
  label: string;
  unit?: string;
  accentVar: string;
  height: number;
  last?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  children: React.ReactNode;
}

function Lane({ label, unit, accentVar, height, last, disabled, disabledHint, children }: LaneProps) {
  return (
    <div className={cn('grid', !last && 'border-b border-border-subtle')} style={{ gridTemplateColumns: `${LABEL_COL_WIDTH}px 1fr` }} title={disabled ? disabledHint : undefined}>
      <div className="flex flex-col justify-center gap-0.5 border-r border-border-subtle bg-bg-elevated px-3 py-2">
        <div className={cn('text-[10px] font-semibold uppercase tracking-wider', disabled && 'text-dim')} style={disabled ? undefined : { color: `var(${accentVar})` }}>
          {label}
        </div>
        {unit && <div className="font-mono text-[9.5px] text-dim">{unit}</div>}
      </div>
      <div className="relative px-3" style={{ height }}>
        {disabled ? <div className="flex h-full items-center justify-center text-[10px] italic text-dim">{disabledHint}</div> : children}
      </div>
    </div>
  );
}

export function ProsodyTimeline({ duration, words, pitchCurve, wordRates, capabilities, isLoading, onPitchCurveChange, onWordRateChange }: Props) {
  const { t } = useTranslation();
  const pitchRef = useRef<SVGSVGElement>(null);
  const unsupportedHint = t('studio.tuningUnsupported');

  const curve = pitchCurve.length >= 2 ? pitchCurve : makeDefaultCurve(words.length);

  const handlePitchPointDrag = useCallback(
    (pointIndex: number, event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      const svg = pitchRef.current;
      if (!svg) {
        return;
      }
      const move = (e: PointerEvent) => {
        const rect = svg.getBoundingClientRect();
        const y = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
        const next = curve.map((pt, i) => (i === pointIndex ? ([pt[0], y] as PitchPoint) : pt));
        onPitchCurveChange(next);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [curve, onPitchCurveChange],
  );

  const handleBarDrag = useCallback(
    (wordIndex: number, currentRate: number, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = event.currentTarget.parentElement;
      if (!container) {
        return;
      }
      const laneHeight = container.getBoundingClientRect().height;
      const startY = event.clientY;
      const startRate = currentRate;
      const range = MAX_RATE - MIN_RATE;

      const move = (e: PointerEvent) => {
        const deltaY = e.clientY - startY;
        const delta = (-deltaY / laneHeight) * range;
        const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, startRate + delta));
        onWordRateChange(wordIndex, Number(rate.toFixed(2)));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [onWordRateChange],
  );

  const hasAlignment = duration > 0 && words.length > 0;

  const pitchPath = useMemo(() => pitchCurveToPath(curve, 1000, 100), [curve]);
  const pitchArea = useMemo(() => pitchCurveToAreaPath(curve, 1000, 100), [curve]);
  const pitchPoints = useMemo(
    () =>
      curve.map(([t01, p01], idx) => ({
        idx,
        t01,
        p01,
        key: `pitch-${t01.toFixed(4)}`,
      })),
    [curve],
  );

  if (isLoading || !hasAlignment) {
    return <div className="flex items-center justify-center py-10 text-xs text-dim">{isLoading ? <Loader2 className="size-4 animate-spin" /> : t('studio.timelineNoData')}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <Lane label={t('studio.laneWords')} accentVar="--foreground" height={WORD_LANE_HEIGHT}>
          {words.map((w) => {
            const left = (w.start / duration) * 100;
            const width = ((w.end - w.start) / duration) * 100;
            return (
              <div key={w.index} className="absolute top-1 flex items-center overflow-hidden rounded border border-border-subtle bg-card px-1.5 py-0.5 font-serif text-[11px] text-muted-foreground" style={{ left: `${left}%`, width: `calc(${width}% - 2px)`, height: 24 }}>
                <span className="truncate">{w.text}</span>
              </div>
            );
          })}
        </Lane>

        <Lane label={t('studio.lanePitch')} unit="Hz" accentVar="--accent-violet" height={PITCH_LANE_HEIGHT} disabled={!capabilities.pitch} disabledHint={unsupportedHint}>
          <svg ref={pitchRef} viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label={t('studio.lanePitch')} className="absolute inset-x-3 top-0 h-full" style={{ width: 'calc(100% - 1.5rem)' }}>
            {curve.length === 0 ? (
              <line x1="0" y1="50" x2="1000" y2="50" stroke="var(--border)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ) : (
              <>
                <path d={pitchArea} fill="var(--accent-violet)" fillOpacity="0.18" />
                <path d={pitchPath} stroke="var(--accent-violet)" strokeWidth="1.6" fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                {pitchPoints.map(({ idx, t01, p01, key }) => (
                  <circle key={key} cx={t01 * 1000} cy={(1 - p01) * 100} r="6" fill="var(--background)" stroke="var(--accent-violet)" strokeWidth="2" className="cursor-ns-resize" onPointerDown={(e) => handlePitchPointDrag(idx, e)} />
                ))}
              </>
            )}
          </svg>
        </Lane>

        <Lane label={t('studio.laneSpeed')} unit="×" accentVar="--accent-green" height={SPEED_LANE_HEIGHT} last disabled={!capabilities.perWordSpeed} disabledHint={unsupportedHint}>
          <div className="absolute inset-x-3 top-1/2 h-px -translate-y-px border-t border-dashed border-border" />
          {words.map((w) => {
            const rate = wordRates[String(w.index)] ?? 1;
            const left = (w.start / duration) * 100;
            const width = Math.max(0.5, ((w.end - w.start) / duration) * 100 - 0.5);
            const ratio = Math.min(1, Math.max(0, (rate - MIN_RATE) / (MAX_RATE - MIN_RATE)));
            const barHeight = Math.abs(ratio - 0.5) * SPEED_LANE_HEIGHT;
            const barTop = ratio >= 0.5 ? (1 - ratio) * SPEED_LANE_HEIGHT : SPEED_LANE_HEIGHT / 2;
            const color = ratio >= 0.5 ? 'var(--accent-green)' : 'var(--accent-rust)';
            return (
              <div
                key={w.index}
                onPointerDown={(e) => handleBarDrag(w.index, rate, e)}
                className="absolute cursor-ns-resize rounded-sm transition-colors hover:brightness-125"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  top: barTop,
                  height: Math.max(3, barHeight),
                  background: color,
                  opacity: 0.55,
                }}
                title={`${w.text} · ${rate.toFixed(2)}×`}
              />
            );
          })}
        </Lane>
      </div>
    </div>
  );
}
