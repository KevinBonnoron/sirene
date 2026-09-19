import { createFileRoute } from '@tanstack/react-router';
import { GeneralPage } from '@/components/admin/general-page';

export const Route = createFileRoute('/_app/admin/general')({
  component: GeneralPage,
});
