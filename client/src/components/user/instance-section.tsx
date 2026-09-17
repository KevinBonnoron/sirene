import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { type InstanceSettings, instanceClient } from '@/clients/instance.client';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SETUP_STATUS_QUERY_KEY } from '@/hooks/use-setup-status';

const INSTANCE_KEY = ['instance-settings'] as const;

export function InstanceSection() {
  const { t } = useTranslation();
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
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="instance-registration">{t('instance.registration')}</Label>
        <p className="text-sm text-muted-foreground">{t('instance.registrationHint')}</p>
      </div>
      {isLoading ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Switch id="instance-registration" checked={enabled} disabled={isPending} onCheckedChange={(registration_enabled) => mutate({ registration_enabled })} />}
    </div>
  );
}
