import { ArrowRight, GripVertical, Play, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { TakeWaveform } from './take-waveform';

export interface BankEntry {
  id: string;
  voiceName: string;
  voiceAvatarUrl?: string;
  modelName: string;
  text: string;
  duration: number;
  createdAt: Date;
}

interface Props {
  entries: BankEntry[];
}

function formatRelative(date: Date, now = new Date()): string {
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 60) {
    return 'maintenant';
  }
  if (diff < 3600) {
    return `il y a ${Math.floor(diff / 60)} min`;
  }
  if (diff < 86400) {
    return `il y a ${Math.floor(diff / 3600)} h`;
  }
  return date.toLocaleDateString();
}

export function TakeBank({ entries }: Props) {
  const { t } = useTranslation();

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border-subtle bg-bg-elevated">
      <header className="flex h-12 items-center gap-2 border-b border-border-subtle px-4">
        <Sparkles className="size-3.5 text-accent-amber" />
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
        <ul className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-3">
          {entries.map((entry, i) => (
            <BankCard key={entry.id} entry={entry} seed={i + 1} />
          ))}
        </ul>
      )}

      <footer className="border-t border-border-subtle p-3">
        <button type="button" className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-xs transition-colors', 'text-muted-foreground hover:bg-card hover:text-foreground')}>
          <span>{t('studio.allSessions')}</span>
          <ArrowRight className="size-3.5" />
        </button>
      </footer>
    </aside>
  );
}

function BankCard({ entry, seed }: { entry: BankEntry; seed: number }) {
  return (
    <li draggable className={cn('group flex cursor-grab flex-col gap-2 rounded-md border border-border-subtle bg-card p-2.5 transition-colors', 'hover:border-border hover:bg-card-elevated active:cursor-grabbing')}>
      <div className="flex items-center gap-2">
        <GripVertical className="size-3 shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
        <Avatar className="size-5 shrink-0">
          <AvatarImage src={entry.voiceAvatarUrl} alt={entry.voiceName} />
          <AvatarFallback className="text-[9px]">{entry.voiceName.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="truncate text-xs font-medium">{entry.voiceName}</span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-dim">{entry.duration.toFixed(1)}s</span>
      </div>

      <p className="line-clamp-2 font-serif text-[13px] leading-snug text-foreground/90">{entry.text}</p>

      <div className="flex items-center gap-2">
        <button type="button" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-foreground transition-colors hover:bg-accent-amber hover:text-bg-elevated" aria-label="Play">
          <Play className="size-3 translate-x-[0.5px]" />
        </button>
        <TakeWaveform seed={seed * 11 + 3} bars={48} className="h-6 flex-1" />
        <span className="font-mono text-[10px] tabular-nums text-dim">{formatRelative(entry.createdAt)}</span>
      </div>
    </li>
  );
}
