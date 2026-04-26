interface Props {
  seed?: number;
  bars?: number;
  active?: boolean;
  progress?: number; // 0..1
  className?: string;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 40;
const BAR_GAP = 2;

export function TakeWaveform({ seed = 42, bars = 80, active = false, progress = 0, className }: Props) {
  const safeBars = Math.max(1, Math.floor(bars));
  const safeProgress = Math.min(1, Math.max(0, progress));
  const rand = seededRandom(seed);
  const data = Array.from({ length: safeBars }, () => {
    const base = 0.08 + rand() * 0.18;
    const peak = rand() > 0.72 ? rand() * 0.8 : 0;
    return Math.min(1, base + peak);
  });

  const barW = Math.max(1, (VIEWBOX_WIDTH - BAR_GAP * (safeBars - 1)) / safeBars);
  const activeColor = 'var(--accent-amber)';
  const idleColor = 'var(--dim)';

  return (
    <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="waveform" className={`block h-10 w-full ${className ?? ''}`}>
      {data.map((amp, i) => {
        const h = Math.max(1.5, amp * VIEWBOX_HEIGHT);
        const x = i * (barW + BAR_GAP);
        const y = (VIEWBOX_HEIGHT - h) / 2;
        const played = i / safeBars < safeProgress;
        const fill = active || played ? activeColor : idleColor;
        const opacity = played ? 1 : active ? 0.55 : 0.7;
        const r = barW / 2;
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: static waveform bars never reorder
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={r}
            ry={r}
            fill={fill}
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
}
