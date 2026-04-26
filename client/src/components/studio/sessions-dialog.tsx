import type { Generation, Session } from '@sirene/shared';
import { useNavigate } from '@tanstack/react-router';
import { Check, MessageSquareText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/utils/format-relative';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Session[];
  generations: Generation[];
  activeSessionId: string | null;
  onRequestDelete: (sessionId: string, displayName: string) => void;
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

export function SessionsDialog({ open, onOpenChange, sessions, generations, activeSessionId, onRequestDelete }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const handleSelect = (sessionId: string) => {
    navigate({ to: '/', search: { session: sessionId }, replace: true });
    onOpenChange(false);
  };

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
                <li key={session.id} className={cn('group/row relative flex items-stretch rounded-md transition-colors', isActive && 'bg-accent-amber/10')}>
                  <Button variant="ghost" onClick={() => handleSelect(session.id)} className={cn('h-auto min-w-0 flex-1 justify-start gap-3 px-3 py-2.5 text-left font-normal', isActive && 'hover:bg-accent-amber/15')}>
                    <MessageSquareText className={cn('size-4 shrink-0', isActive ? 'text-accent-amber' : 'text-dim')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('truncate font-serif text-sm', !session.name?.trim() && 'italic text-dim')}>{displayName}</span>
                        {isActive && <Check className="size-3.5 shrink-0 text-accent-amber" />}
                      </div>
                      {preview && <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">{preview}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-mono text-[10.5px] tabular-nums text-dim">{formatRelative(session.updated, t)}</span>
                      <span className="font-mono text-[10px] tabular-nums text-dim">{t(ids.length === 1 ? 'studio.takeCountSingular' : 'studio.takeCountPlural', { count: ids.length })}</span>
                    </div>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onRequestDelete(session.id, displayName)} aria-label={t('common.delete')} className="shrink-0 self-center text-dim opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100 focus-visible:opacity-100">
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
