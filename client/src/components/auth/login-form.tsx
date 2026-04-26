import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useValidators } from '@/hooks/use-validators';
import { useAppForm, zodFieldErrors } from '@/lib/form';
import { useAuth } from '@/providers/auth-provider';

export function LoginForm() {
  const { t } = useTranslation();
  const v = useValidators();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');

  const schema = z.object({
    email: v.email(),
    password: v.minLength(8),
  });

  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    validators: {
      onSubmit: ({ value }) => {
        const result = schema.safeParse(value);
        if (!result.success) {
          return { fields: zodFieldErrors(result.error) };
        }

        return undefined;
      },
    },
    onSubmit: async ({ value }) => {
      setServerError('');
      try {
        await login(value.email, value.password);
        navigate({ to: '/' });
      } catch (err) {
        setServerError(t([`login.${err instanceof Error ? err.message : ''}`, 'login.failed']));
      }
    },
  });

  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight">{t('login.title')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('login.subtitle')}</p>
      </div>

      {serverError && <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{serverError}</div>}

      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.AppField name="email">{(field) => <field.EmailField label={t('login.email')} placeholder={t('login.emailPlaceholder')} autoComplete="email" />}</form.AppField>

        <form.AppField name="password">{(field) => <field.PasswordField label={t('login.password')} autoComplete="current-password" />}</form.AppField>

        <form.AppForm>
          <form.SubscribeButton>{t('login.submit')}</form.SubscribeButton>
        </form.AppForm>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t('login.noAccount')}{' '}
        <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('login.register')}
        </Link>
      </p>
    </>
  );
}
