import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { GenerateForm } from '@/components/generation/generate-form';

export const Route = createFileRoute('/')({
  component: GeneratePage,
});

function GeneratePage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl font-bold tracking-tight">{t('generate.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('generate.subtitle')}</p>
      </div>
      <GenerateForm />
    </div>
  );
}
