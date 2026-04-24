import type { VoiceCapabilities } from '@sirene/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TakeTuning } from './take';

interface Props {
  tuning: TakeTuning;
  capabilities: VoiceCapabilities;
  onChange: (tuning: TakeTuning) => void;
}

interface SliderRowProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  disabled?: boolean;
  disabledHint?: string;
  onChange: (value: number) => void;
  accentVar: string;
}

function SliderRow({ label, unit, value, min, max, step, displayValue, disabled, disabledHint, onChange, accentVar }: SliderRowProps) {
  const ratio = (value - min) / (max - min);
  return (
    <div className={cn('flex flex-col gap-1.5', disabled && 'opacity-55')} title={disabled ? disabledHint : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-[9.5px] font-semibold uppercase tracking-wider', disabled && 'text-dim')} style={disabled ? undefined : { color: `var(${accentVar})` }}>
          {label}
        </span>
        {disabled ? (
          <span className="truncate text-[10px] italic text-dim">{disabledHint}</span>
        ) : (
          <span className="font-mono text-[10.5px] tabular-nums text-foreground">
            {displayValue} <span className="text-dim">{unit}</span>
          </span>
        )}
      </div>
      <div className="relative flex h-[18px] items-center">
        <div className="absolute inset-x-0 h-[2px] rounded-full bg-border-subtle" />
        {!disabled && (
          <div
            className="absolute h-[2px] rounded-full"
            style={{
              left: 0,
              width: `${ratio * 100}%`,
              background: `var(${accentVar})`,
              opacity: 0.7,
            }}
          />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed
            [&::-webkit-slider-thumb]:size-3
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:rounded-full
            [&::-moz-range-thumb]:size-3
            [&::-moz-range-thumb]:rounded-full"
          style={{ colorScheme: 'dark' }}
        />
        {!disabled && (
          <span
            className="pointer-events-none absolute size-3 rounded-full border-2 border-bg-elevated"
            style={{
              left: `calc(${ratio * 100}% - 6px)`,
              background: `var(${accentVar})`,
              boxShadow: `0 0 0 1px color-mix(in oklch, var(${accentVar}) 50%, transparent)`,
            }}
          />
        )}
      </div>
    </div>
  );
}

export function TakeQuickTuning({ tuning, capabilities, onChange }: Props) {
  const { t } = useTranslation();
  const unsupportedHint = t('studio.tuningUnsupported');

  return (
    <div className="grid grid-cols-1 gap-5 px-4 py-3 sm:grid-cols-3 sm:px-5">
      <SliderRow
        label={t('studio.pitch')}
        unit={t('studio.pitchUnit')}
        value={tuning.pitchShift}
        min={-3}
        max={3}
        step={0.5}
        displayValue={tuning.pitchShift > 0 ? `+${tuning.pitchShift}` : `${tuning.pitchShift}`}
        disabled={!capabilities.pitch}
        disabledHint={unsupportedHint}
        onChange={(pitchShift) => onChange({ ...tuning, pitchShift })}
        accentVar="--accent-violet"
      />
      <SliderRow
        label={t('studio.speed')}
        unit="×"
        value={tuning.speedMultiplier}
        min={0.5}
        max={1.5}
        step={0.05}
        displayValue={tuning.speedMultiplier.toFixed(2)}
        disabled={!capabilities.speed}
        disabledHint={unsupportedHint}
        onChange={(speedMultiplier) => onChange({ ...tuning, speedMultiplier })}
        accentVar="--accent-green"
      />
      <SliderRow
        label={t('studio.variation')}
        unit="seed"
        value={tuning.variationSeed}
        min={0}
        max={1}
        step={0.05}
        displayValue={tuning.variationSeed.toFixed(1)}
        disabled={!capabilities.variation}
        disabledHint={unsupportedHint}
        onChange={(variationSeed) => onChange({ ...tuning, variationSeed })}
        accentVar="--accent-amber"
      />
    </div>
  );
}
