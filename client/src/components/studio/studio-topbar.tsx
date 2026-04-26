import { Check, ChevronRight, Download, Globe, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface Props {
  sessionName: string | null;
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
  /** Triggered when the user picks "Rename" in the 3-dot menu. The page-level H1 owns the
   * actual editor — the topbar shows the name read-only as a scroll anchor. */
  onRename?: () => void;
}

export function StudioTopbar({ sessionName, saved = true, saving = false, takeCount, inSession, isPublic, onShare, onExport, onDelete, onRename }: Props) {
  const { t } = useTranslation();

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

      {/* Title (read-only — the page H1 below is the canonical editor). Kept in the topbar so
          that scrolling past the H1 doesn't leave the user without a session reference. */}
      {inSession && (
        <>
          <span className="hidden shrink-0 text-muted-foreground sm:inline">·</span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate font-serif text-sm tracking-tight text-muted-foreground">{sessionName ?? <span className="italic text-dim">{t('studio.untitledSession')}</span>}</span>

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
              <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground sm:px-3" aria-label={t('studio.moreActions')}>
                <MoreHorizontal className="size-3.5" />
                <span className="hidden sm:inline">{t('studio.more')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {onRename && (
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil className="size-3.5" />
                  {t('studio.rename')}
                </DropdownMenuItem>
              )}
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
