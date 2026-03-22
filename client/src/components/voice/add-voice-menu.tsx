import { Plus, Sparkles, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useModels } from '@/hooks/use-models';
import { ImportVoiceDialog } from './import-voice-dialog';
import { VoiceDesignerDialog } from './voice-designer-dialog';
import { VoiceDialog } from './voice-dialog';

export function AddVoiceMenu({ children }: { children: React.ReactNode }) {
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
