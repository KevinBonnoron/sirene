import { RotateCw, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { TakeTuning } from './take';

interface Props {
  tuning: TakeTuning;
  onChange: (tuning: TakeTuning) => void;
  onRegenerate: () => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
  accentVar: string;
}

function SliderRow({ label, value, min, max, step, displayValue, onChange, accentVar }: SliderRowProps) {
  const ratio = (value - min) / (max - min);
  return (
    <div className="grid grid-cols-[90px_1fr_56px] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-border-subtle" />
        <div
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
          style={{
            left: 0,
            width: `${ratio * 100}%`,
            background: `var(${accentVar})`,
            opacity: 0.8,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:size-3.5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-background
            [&::-webkit-slider-thumb]:bg-foreground
            [&::-webkit-slider-thumb]:shadow-sm
            [&::-moz-range-thumb]:size-3.5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-background
            [&::-moz-range-thumb]:bg-foreground"
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-foreground">{displayValue}</span>
    </div>
  );
}

export function TakeQuickTuning({ tuning, onChange, onRegenerate }: Props) {
  const { t } = useTranslation();

  return (
    <div className="border-t border-border-subtle bg-bg-elevated px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{t('studio.quickTuning')}</span>
      </div>

      <div className="space-y-2.5">
        <SliderRow label={t('studio.pitch')} value={tuning.pitchShift} min={-3} max={3} step={0.5} displayValue={tuning.pitchShift > 0 ? `+${tuning.pitchShift}` : `${tuning.pitchShift}`} onChange={(pitchShift) => onChange({ ...tuning, pitchShift })} accentVar="--accent-violet" />
        <SliderRow label={t('studio.speed')} value={tuning.speedMultiplier} min={0.5} max={1.5} step={0.05} displayValue={`${tuning.speedMultiplier.toFixed(2)}×`} onChange={(speedMultiplier) => onChange({ ...tuning, speedMultiplier })} accentVar="--accent-green" />
        <SliderRow label={t('studio.variation')} value={tuning.variationSeed} min={0} max={1} step={0.05} displayValue={tuning.variationSeed.toFixed(2)} onChange={(variationSeed) => onChange({ ...tuning, variationSeed })} accentVar="--accent-amber" />
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-3">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onRegenerate}>
          <RotateCw className="size-3.5" />
          {t('studio.regenerateWithTuning')}
          <span className="ml-1 font-mono text-[10px] opacity-70">⌘↵</span>
        </Button>
      </div>
    </div>
  );
}
