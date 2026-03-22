import type { Voice } from '@sirene/shared';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useModels } from '@/hooks/use-models';
import { AddVoiceMenu } from './add-voice-menu';
import { VoiceItem } from './voice-item';

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

interface Props {
  voices: Voice[];
  selectedId: string;
  onSelect: (id: string) => void;
  empty: boolean;
  showAddButton?: boolean;
  editOnClick?: boolean;
}

export function VoiceGrid({ voices, selectedId, onSelect, empty, showAddButton = true, editOnClick }: Props) {
  const { t } = useTranslation();
  const { catalog, installations } = useModels();
  const hasAnyModel = catalog.some((m) => !m.types.includes('transcription') && !m.types.every((t) => t === 'design') && installations?.some((i) => i.id === m.id && i.status === 'installed'));

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
    if (!showAddButton) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-muted-foreground/25 py-6 text-center">
          <p className="text-sm text-muted-foreground">{t('voice.emptyGoManage')}</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/voices">{t('nav.voices')}</Link>
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
          <VoiceItem key={v.id} voice={v} selected={selectedId === v.id} onSelect={onSelect} variant="bubble" editOnClick={editOnClick} />
        ))}
        {showAddButton && (
          <AddVoiceMenu>
            <button type="button" className="group flex flex-col items-center gap-1">
              <div className="flex size-12 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/25 transition-colors group-hover:border-muted-foreground/50 group-hover:bg-accent/50">
                <Plus className="size-4 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
              </div>
              <span className="w-14 text-center text-[10px] text-muted-foreground">{t('voice.add')}</span>
            </button>
          </AddVoiceMenu>
        )}
      </div>

      {/* Tablet: compact cards */}
      <div className="hidden gap-2 md:grid md:grid-cols-4 lg:hidden">
        {voices.map((v) => (
          <VoiceItem key={v.id} voice={v} selected={selectedId === v.id} onSelect={onSelect} variant="compact" editOnClick={editOnClick} />
        ))}
        {showAddButton && <AddButton className="group flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 transition-colors hover:border-muted-foreground/40 focus-visible:outline-none" />}
      </div>

      {/* Desktop: full cards */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-3">
        {voices.map((v) => (
          <VoiceItem key={v.id} voice={v} selected={selectedId === v.id} onSelect={onSelect} variant="full" editOnClick={editOnClick} />
        ))}
        {showAddButton && <AddButton className="group flex min-h-24 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 transition-colors hover:border-muted-foreground/40 focus-visible:outline-none" />}
      </div>
    </>
  );
}
