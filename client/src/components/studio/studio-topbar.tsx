import { Check, ChevronRight, Download, Globe, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface Props {
  sessionName: string | null;
  onSessionNameChange: (name: string | null) => void;
  saved?: boolean;
  saving?: boolean;
  takeCount: number;
  /** True once the user has committed to session mode — drives the breadcrumb + title editor.
   * Decoupled from takeCount because a fresh session can still be empty (just promoted from solo). */
  inSession: boolean;
  /** Whether the current session is published — drives the green Globe pill next to Share. */
  isPublic?: boolean;
  onShare?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}

export function StudioTopbar({ sessionName, onSessionNameChange, saved = true, saving = false, takeCount, inSession, isPublic, onShare, onExport, onDelete }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sessionName ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(sessionName ?? '');
  }, [sessionName]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    onSessionNameChange(trimmed.length > 0 ? trimmed : null);
    setEditing(false);
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle bg-background/70 px-3 backdrop-blur-sm sm:gap-3 sm:px-4">
      {/* Breadcrumb */}
      <nav className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span>{t('studio.breadcrumbStudio')}</span>
        {inSession && (
          <>
            <ChevronRight className="size-3" />
            <span className="hidden sm:inline">{t('studio.breadcrumbSession')}</span>
          </>
        )}
      </nav>

      {/* Title (only visible once we have a session) */}
      {inSession && (
        <>
          <span className="hidden shrink-0 text-muted-foreground sm:inline">·</span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commit();
                  } else if (e.key === 'Escape') {
                    setDraft(sessionName ?? '');
                    setEditing(false);
                  }
                }}
                placeholder={t('studio.untitledSession')}
                className="min-w-0 max-w-full bg-transparent font-serif text-sm italic tracking-tight outline-none field-sizing-content placeholder:text-dim"
              />
            ) : (
              <button type="button" onClick={() => setEditing(true)} className="min-w-0 truncate text-left font-serif text-sm tracking-tight transition-colors hover:text-accent-amber">
                {sessionName ?? <span className="italic text-dim">{t('studio.untitledSession')}</span>}
              </button>
            )}

            {/* Save state */}
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-dim">
              {saving ? (
                <span className="hidden sm:inline">{t('studio.saving')}</span>
              ) : saved ? (
                <>
                  <Check className="size-3" />
                  <span className="hidden sm:inline">{t('studio.saved')}</span>
                </>
              ) : null}
            </span>
          </div>
        </>
      )}

      {/* Right actions */}
      <div className={`flex shrink-0 items-center gap-1 ${inSession ? '' : 'ml-auto'}`}>
        {inSession && takeCount > 0 && (
          <>
            <Button variant="ghost" size="sm" disabled={!onShare} onClick={onShare} className="gap-1.5 px-2 text-muted-foreground sm:px-3" aria-label={t('studio.share')}>
              {isPublic ? <Globe className="size-3.5 text-accent-amber" /> : <Share2 className="size-3.5" />}
              <span className="hidden sm:inline">{t('studio.share')}</span>
            </Button>
            <Button variant="ghost" size="sm" disabled={!onExport} onClick={onExport} className="gap-1.5 px-2 text-muted-foreground sm:px-3" aria-label={t('studio.export')}>
              <Download className="size-3.5" />
              <span className="hidden sm:inline">{t('studio.export')}</span>
            </Button>
          </>
        )}
        {inSession && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={t('studio.moreActions')}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil className="size-3.5" />
                {t('studio.rename')}
              </DropdownMenuItem>
              {onExport && takeCount > 0 && (
                <DropdownMenuItem onSelect={onExport}>
                  <Download className="size-3.5" />
                  {t('studio.exportZip')}
                </DropdownMenuItem>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
                    <Trash2 className="size-3.5" />
                    {t('common.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
