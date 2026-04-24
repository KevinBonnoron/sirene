interface Props {
  seed?: number;
  bars?: number;
  active?: boolean;
  progress?: number; // 0-1
  className?: string;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

interface Bar {
  key: string;
  height: number;
  ratio: number;
}

export function TakeWaveform({ seed = 42, bars = 96, active = false, progress = 0, className }: Props) {
  const rand = seededRandom(seed);
  const barData: Bar[] = Array.from({ length: bars }, (_, i) => {
    const envelope = Math.sin((i / bars) * Math.PI) * 0.7 + 0.3;
    return {
      key: `${seed}-${i}`,
      height: Math.max(0.15, rand() * envelope),
      ratio: i / bars,
    };
  });

  const activeColor = 'var(--accent-amber)';
  const idleColor = 'var(--dim)';

  return (
    <div className={`flex h-10 items-center gap-[2px] ${className ?? ''}`}>
      {barData.map(({ key, height, ratio }) => {
        const isPlayed = ratio < progress;
        const color = active ? activeColor : isPlayed ? activeColor : idleColor;
        return (
          <div
            key={key}
            className="w-[2px] rounded-full transition-colors"
            style={{
              height: `${height * 100}%`,
              background: color,
              opacity: active && !isPlayed ? 0.45 : 1,
            }}
          />
        );
      })}
    </div>
  );
}
