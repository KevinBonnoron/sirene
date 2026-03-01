import type { Voice } from '@sirene/shared';
import { Link } from '@tanstack/react-router';
import { Plus, Sparkles, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useModels } from '@/hooks/use-models';
import { ImportVoiceDialog } from './import-voice-dialog';
import { VoiceDesignerDialog } from './voice-designer-dialog';
import { VoiceDialog } from './voice-dialog';
import { VoiceItem } from './voice-item';

/** "+" dropdown menu — shown at all breakpoints, disables options with tooltip hints */
function AddVoiceMenu({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDesign, setShowDesign] = useState(false);
  const { catalog, installations } = useModels();

  const hasAnyModel = catalog.some((m) => !m.types.includes('transcription') && !m.types.every((t) => t === 'design') && installations?.some((i) => i.id === m.id && i.status === 'installed'));
  const hasInstructModels = catalog.some((m) => m.types.includes('design') && installations?.some((i) => i.id === m.id && i.status === 'installed'));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {hasAnyModel ? (
            <DropdownMenuItem onSelect={() => setShowNew(true)}>
              <Plus className="size-4" /> {t('voice.newVoice')}
            </DropdownMenuItem>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem disabled>
                  <Plus className="size-4" /> {t('voice.newVoice')}
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="right">{t('voice.needModelHint')}</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenuItem onSelect={() => setShowImport(true)}>
            <Upload className="size-4" /> {t('voice.importVoice')}
          </DropdownMenuItem>
          {hasInstructModels ? (
            <DropdownMenuItem onSelect={() => setShowDesign(true)}>
              <Sparkles className="size-4" /> {t('voice.designVoice')}
            </DropdownMenuItem>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem disabled>
                  <Sparkles className="size-4" /> {t('voice.designVoice')}
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="right">{t('voice.needInstructHint')}</TooltipContent>
            </Tooltip>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {showNew && <VoiceDialog open={showNew} onOpenChange={setShowNew} />}
      {showImport && <ImportVoiceDialog open={showImport} onOpenChange={setShowImport} />}
      {showDesign && <VoiceDesignerDialog open={showDesign} onOpenChange={setShowDesign} />}
    </>
  );
}

/** Dashed "+" trigger button used across all breakpoints */
function AddButton({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <AddVoiceMenu>
      <button type="button" className={className}>
        <Plus className="size-6 lg:size-10 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
        <span className="sr-only">{t('voice.add')}</span>
      </button>
    </AddVoiceMenu>
  );
}

interface VoiceGridProps {
  voices: Voice[];
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  empty: boolean;
}

export function VoiceGrid({ voices, loading, selectedId, onSelect, empty }: VoiceGridProps) {
  const { t } = useTranslation();
  const { catalog, installations } = useModels();
  const hasAnyModel = catalog.some((m) => !m.types.includes('transcription') && !m.types.every((t) => t === 'design') && installations?.some((i) => i.id === m.id && i.status === 'installed'));

  if (loading) {
    return (
      <>
        {/* Mobile skeletons */}
        <div className="flex gap-3 md:hidden">
          {['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => (
            <Skeleton key={id} className="size-12 rounded-full" />
          ))}
        </div>
        {/* Tablet skeletons */}
        <div className="hidden gap-2 md:grid md:grid-cols-4 lg:hidden">
          {['t1', 't2', 't3', 't4'].map((id) => (
            <Skeleton key={id} className="h-14 rounded-lg" />
          ))}
        </div>
        {/* Desktop skeletons */}
        <div className="hidden gap-4 lg:grid lg:grid-cols-3">
          {['d1', 'd2', 'd3'].map((id) => (
            <Skeleton key={id} className="h-24 rounded-xl" />
          ))}
        </div>
      </>
    );
  }

  if (voices.length === 0 && empty) {
    if (!hasAnyModel) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-muted-foreground/25 py-6 text-center">
          <p className="text-sm text-muted-foreground">{t('voice.emptyNoModel')}</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/models">{t('voice.installModel')}</Link>
          </Button>
        </div>
      );
    }
    return (
      <>
        {/* Mobile */}
        <div className="flex flex-wrap gap-3 md:hidden">
          <AddVoiceMenu>
            <button type="button" className="group flex flex-col items-center gap-1">
              <div className="flex size-12 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/25 transition-colors group-hover:border-muted-foreground/50 group-hover:bg-accent/50">
                <Plus className="size-4 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
              </div>
              <span className="w-14 text-center text-[10px] text-muted-foreground">{t('voice.add')}</span>
            </button>
          </AddVoiceMenu>
        </div>
        {/* Tablet */}
        <div className="hidden gap-2 md:grid md:grid-cols-4 lg:hidden">
          <AddButton className="group flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 transition-colors hover:border-muted-foreground/40 focus-visible:outline-none" />
        </div>
        {/* Desktop */}
        <div className="hidden gap-4 lg:grid lg:grid-cols-3">
          <AddButton className="group flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 py-6 transition-colors hover:border-muted-foreground/40 focus-visible:outline-none" />
        </div>
      </>
    );
  }

  if (voices.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('voice.noMatch')}</p>;
  }

  return (
    <>
      {/* Mobile: avatar bubbles */}
      <div className="flex flex-wrap gap-3 md:hidden">
        {voices.map((v) => (
          <VoiceItem key={v.id} voice={v} selected={selectedId === v.id} onSelect={onSelect} variant="bubble" />
        ))}
        <AddVoiceMenu>
          <button type="button" className="group flex flex-col items-center gap-1">
            <div className="flex size-12 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/25 transition-colors group-hover:border-muted-foreground/50 group-hover:bg-accent/50">
              <Plus className="size-4 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
            </div>
            <span className="w-14 text-center text-[10px] text-muted-foreground">{t('voice.add')}</span>
          </button>
        </AddVoiceMenu>
      </div>

      {/* Tablet: compact cards */}
      <div className="hidden gap-2 md:grid md:grid-cols-4 lg:hidden">
        {voices.map((v) => (
          <VoiceItem key={v.id} voice={v} selected={selectedId === v.id} onSelect={onSelect} variant="compact" />
        ))}
        <AddButton className="group flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 transition-colors hover:border-muted-foreground/40 focus-visible:outline-none" />
      </div>

      {/* Desktop: full cards */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-3">
        {voices.map((v) => (
          <VoiceItem key={v.id} voice={v} selected={selectedId === v.id} onSelect={onSelect} variant="full" />
        ))}
        <AddButton className="group flex min-h-24 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 transition-colors hover:border-muted-foreground/40 focus-visible:outline-none" />
      </div>
    </>
  );
}
