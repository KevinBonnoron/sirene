import { GripVertical, Pause, Play, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAudioPlayback } from '@/hooks/use-audio-playback';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/utils/format-relative';
import { TakeWaveform } from './take-waveform';

export interface BankEntry {
  id: string;
  voiceName: string;
  voiceAvatarUrl?: string;
  modelName: string;
  text: string;
  duration: number;
  createdAt: Date;
  audioUrl?: string;
}

/** Custom MIME type used for the bank → document drag-and-drop. Picked so a stray drag onto the
 * editor (or vice versa) won't accidentally trigger our drop logic via `text/plain`. */
export const BANK_DRAG_MIME = 'application/x-sirene-bank-id';

interface Props {
  entries: BankEntry[];
}

export function TakeBank({ entries }: Props) {
  const { t } = useTranslation();

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border-subtle bg-bg-elevated">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
        <Sparkles className="size-3.5 shrink-0 text-accent-amber" />
        <h2 className="font-serif text-sm tracking-tight">{t('studio.bankTitle')}</h2>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-dim">{entries.length}</span>
      </header>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <div className="size-12 rounded-full bg-card" />
          <p className="text-sm text-muted-foreground">{t('studio.bankEmpty')}</p>
          <p className="text-xs text-dim">{t('studio.bankEmptyHint')}</p>
        </div>
      ) : (
        <ul className="custom-scrollbar flex-1 space-y-2 overflow-x-hidden overflow-y-auto p-3">
          {entries.map((entry, i) => (
            <BankCard key={entry.id} entry={entry} seed={i + 1} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function BankCard({ entry, seed }: { entry: BankEntry; seed: number }) {
  const { t } = useTranslation();
  const { isPlaying, progress, toggle } = useAudioPlayback(entry.audioUrl);

  // Custom MIME carries the generation id; `text/plain` is set as a fallback so OS-level drop
  // targets (terminals, text fields outside the app) get something legible if the user drops there.
  const handleDragStart = (e: React.DragEvent<HTMLLIElement>) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(BANK_DRAG_MIME, entry.id);
    e.dataTransfer.setData('text/plain', entry.text);
  };

  return (
    <li draggable onDragStart={handleDragStart} className={cn('group flex w-full cursor-grab flex-col gap-2 overflow-hidden rounded-md border border-border-subtle bg-card p-2.5 transition-colors', 'hover:border-border hover:bg-card-elevated active:cursor-grabbing')}>
      <div className="flex min-w-0 items-center gap-2">
        <GripVertical className="size-3 shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
        <Avatar className="size-5 shrink-0">
          <AvatarImage src={entry.voiceAvatarUrl} alt={entry.voiceName} />
          <AvatarFallback className="text-[9px]">{entry.voiceName.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 truncate text-xs font-medium">{entry.voiceName}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-dim">{entry.duration.toFixed(1)}s</span>
      </div>

      <p className="line-clamp-2 min-w-0 font-serif text-[13px] leading-snug text-foreground/90">{entry.text}</p>

      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={!entry.audioUrl}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-foreground transition-colors hover:bg-accent-amber hover:text-primary-foreground disabled:opacity-50"
          aria-label={isPlaying ? t('studio.pause') : t('studio.play')}
        >
          {isPlaying ? <Pause className="size-3" /> : <Play className="size-3 translate-x-[0.5px]" />}
        </button>
        <div className="min-w-0 flex-1 overflow-hidden">
          <TakeWaveform seed={seed * 11 + 3} bars={32} active={isPlaying} progress={progress} className="h-6" />
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-dim">{formatRelative(entry.createdAt, t)}</span>
      </div>
    </li>
  );
}
