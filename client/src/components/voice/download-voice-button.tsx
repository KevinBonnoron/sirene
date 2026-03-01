import type { Voice } from '@sirene/shared';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { voiceClient } from '@/clients/voice.client';
import { downloadBlob } from '@/lib/download';
import { Button } from '../ui/button';

interface Props {
  voice: Voice;
}

export function DownloadVoiceButton({ voice }: Props) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          const blob = await voiceClient.exportZip(voice.id);
          downloadBlob(blob, `voice-${voice.name.replace(/\s+/g, '-').toLowerCase()}.zip`);
        } catch {
          toast.error(t('voice.exportFailed'));
        }
      }}
    >
      <Download className="size-3.5" />
    </Button>
  );
}
