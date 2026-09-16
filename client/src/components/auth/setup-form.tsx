import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { SETUP_STATUS_QUERY_KEY } from '@/hooks/use-setup-status';
import { useValidators } from '@/hooks/use-validators';
import { useAppForm, zodValidator } from '@/lib/form';
import { useAuth } from '@/providers/auth-provider';

export function SetupForm() {
  const { t } = useTranslation();
  const v = useValidators();
  const { register } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState('');

  const schema = z
    .object({
      name: v.required(),
      email: v.email(),
      password: v.minLength(8),
      passwordConfirm: z.string(),
    })
    .superRefine(({ passwordConfirm, password }, ctx) => {
      if (passwordConfirm !== password) {
        ctx.addIssue({ code: 'custom', message: v.passwordMismatch(), path: ['passwordConfirm'] });
      }
    });

  const form = useAppForm({
    defaultValues: { name: '', email: '', password: '', passwordConfirm: '' },
    validators: { onSubmit: zodValidator(schema) },
    onSubmit: async ({ value }) => {
      setServerError('');
      try {
        await register(value.email, value.password, value.name);
        // Invalidating instead would let the route guard read the stale answer and bounce back here.
        qc.setQueryData(SETUP_STATUS_QUERY_KEY, { needsSetup: false });
        navigate({ to: '/' });
      } catch (err) {
        const code = err instanceof Error ? err.message : '';
        setServerError(t([`setup.${code}`, `errors.${code}`, 'setup.failed']));
      }
    },
  });

  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight">{t('setup.title')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('setup.subtitle')}</p>
      </div>

      {serverError && (
        <div role="alert" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.AppField name="name">{(field) => <field.InputField label={t('setup.name')} placeholder={t('setup.namePlaceholder')} autoComplete="name" />}</form.AppField>

        <form.AppField name="email">{(field) => <field.EmailField label={t('setup.email')} placeholder={t('setup.emailPlaceholder')} autoComplete="email" />}</form.AppField>

        <form.AppField name="password">{(field) => <field.PasswordField label={t('setup.password')} autoComplete="new-password" />}</form.AppField>

        <form.AppField name="passwordConfirm">{(field) => <field.PasswordField label={t('setup.passwordConfirm')} autoComplete="new-password" />}</form.AppField>

        <form.AppForm>
          <form.SubscribeButton>{t('setup.submit')}</form.SubscribeButton>
        </form.AppForm>
      </form>
    </>
  );
}
