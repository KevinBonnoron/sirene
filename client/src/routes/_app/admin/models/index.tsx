import { createFileRoute } from '@tanstack/react-router';
import { ModelsPage } from '@/components/model/models-page';

export const Route = createFileRoute('/_app/admin/models/')({
  component: ModelsPage,
});
