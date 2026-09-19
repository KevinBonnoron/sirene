import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { type InstanceSettings, instanceClient } from '@/clients/instance.client';
import { Section } from '@/components/layout/section';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useIsMobile } from '@/hooks/use-mobile';
import { SETUP_STATUS_QUERY_KEY } from '@/hooks/use-setup-status';

const INSTANCE_KEY = ['instance-settings'] as const;

export function GeneralPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: INSTANCE_KEY, queryFn: () => instanceClient.get() });

  const { mutate, isPending } = useMutation({
    mutationFn: (next: Partial<InstanceSettings>) => instanceClient.update(next),
    onSuccess: (settings) => {
      queryClient.setQueryData(INSTANCE_KEY, settings);
      queryClient.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('instance.saveFailed')),
  });

  const enabled = data?.registration_enabled ?? true;

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar label={t('instance.title')} subtitle={t('instance.description')} />
      <main className={`custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6 ${isMobile ? 'pb-24' : ''}`}>
        <Section title={t('instance.access')}>
          <div className="divide-y divide-border-subtle rounded-lg border border-border bg-card">
            <div className="flex items-start justify-between gap-6 px-4 py-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="instance-registration">{t('instance.registration')}</Label>
                <p className="text-sm text-muted-foreground">{t('instance.registrationHint')}</p>
              </div>
              {isLoading ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Switch id="instance-registration" checked={enabled} disabled={isPending} onCheckedChange={(registration_enabled) => mutate({ registration_enabled })} />}
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
