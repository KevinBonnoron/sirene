import { useLiveQuery } from '@tanstack/react-db';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { voiceCollection } from '@/collections';
import { VoiceList } from '@/components/generation/voice-list';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { AddVoiceMenu } from './add-voice-menu';

export function VoicesPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { data: voices, isLoading: voicesLoading } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar
        label={t('nav.voices')}
        subtitle={t('voice.pageSubtitle')}
        actions={
          <AddVoiceMenu>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Plus className="size-3.5" />
              {t('voice.add')}
            </Button>
          </AddVoiceMenu>
        }
      />
      <main className={`custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6 ${isMobile ? 'pb-24' : ''}`}>
        <VoiceList voices={voices} voicesLoading={voicesLoading} voiceId="" onSelectVoice={() => {}} editOnClick />
      </main>
    </div>
  );
}
