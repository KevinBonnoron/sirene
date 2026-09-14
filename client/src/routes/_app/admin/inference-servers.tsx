import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AdminPage } from '@/components/admin/admin-page';
import { InferenceServersSection } from '@/components/admin/inference-servers-section';

export const Route = createFileRoute('/_app/admin/inference-servers')({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  return (
    <AdminPage label={t('inferenceServers.title')}>
      <InferenceServersSection />
    </AdminPage>
  );
}
