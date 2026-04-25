import type { Generation, Session } from '@sirene/shared';
import { Check, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Session[];
  generations: Generation[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
}

function formatRelative(iso: string, now = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) {
    return "à l'instant";
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)} min`;
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)} h`;
  }
  const days = Math.floor(diff / 86400);
  if (days < 7) {
    return `${days} j`;
  }
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
}

export function SessionsDialog({ open, onOpenChange, sessions, generations, activeSessionId, onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl tracking-tight">{t('studio.allSessions')}</DialogTitle>
        </DialogHeader>

        {sessions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('studio.noSessions')}</p>
        ) : (
          <ul className="custom-scrollbar -mx-2 max-h-[60vh] overflow-y-auto">
            {sessions.map((session) => {
              const ids = asStringArray(session.generations);
              const firstGen = generations.find((g) => g.id === ids[0]);
              const preview = firstGen?.text?.trim() ?? '';
              const isActive = session.id === activeSessionId;
              const displayName = session.name?.trim().length ? session.name : t('studio.untitledSession');
              return (
                <li key={session.id}>
                  <button type="button" onClick={() => onSelect(session.id)} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors', isActive ? 'bg-accent-amber/10' : 'hover:bg-card')}>
                    <MessageSquareText className={cn('size-4 shrink-0', isActive ? 'text-accent-amber' : 'text-dim')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('truncate font-serif text-sm', !session.name?.trim() && 'italic text-dim')}>{displayName}</span>
                        {isActive && <Check className="size-3.5 shrink-0 text-accent-amber" />}
                      </div>
                      {preview && <p className="mt-0.5 truncate text-xs text-muted-foreground">{preview}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-mono text-[10.5px] tabular-nums text-dim">{formatRelative(session.updated)}</span>
                      <span className="font-mono text-[10px] tabular-nums text-dim">{t(ids.length === 1 ? 'studio.takeCountSingular' : 'studio.takeCountPlural', { count: ids.length })}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
