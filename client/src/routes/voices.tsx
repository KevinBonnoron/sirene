import { useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { voiceCollection } from '@/collections';
import { VoiceList } from '@/components/generation/voice-list';
import { Button } from '@/components/ui/button';
import { AddVoiceMenu } from '@/components/voice/voice-grid';

export const Route = createFileRoute('/voices')({
  component: VoicesPage,
});

function VoicesPage() {
  const { t } = useTranslation();
  const { data: voices, isLoading: voicesLoading } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('nav.voices')}</h2>
          <p className="text-sm text-muted-foreground">{t('voice.pageSubtitle')}</p>
        </div>
        <AddVoiceMenu>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="size-4" />
            {t('voice.add')}
          </Button>
        </AddVoiceMenu>
      </div>
      <div className="custom-scrollbar -mx-6 min-h-0 flex-1 overflow-y-auto px-6">
        <VoiceList voices={voices} voicesLoading={voicesLoading} voiceId="" onSelectVoice={() => {}} editOnClick />
      </div>
    </div>
  );
}
