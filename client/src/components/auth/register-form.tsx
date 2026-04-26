import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useValidators } from '@/hooks/use-validators';
import { useAppForm, zodFieldErrors } from '@/lib/form';
import { useAuth } from '@/providers/auth-provider';

export function RegisterForm() {
  const { t } = useTranslation();
  const v = useValidators();
  const { register } = useAuth();
  const navigate = useNavigate();
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
        await register(value.email, value.password, value.name);
        navigate({ to: '/' });
      } catch (err) {
        setServerError(t([`register.${err instanceof Error ? err.message : ''}`, 'register.failed']));
      }
    },
  });

  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight">{t('register.title')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('register.subtitle')}</p>
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
        <form.AppField name="name">{(field) => <field.InputField label={t('register.name')} placeholder={t('register.namePlaceholder')} autoComplete="name" />}</form.AppField>

        <form.AppField name="email">{(field) => <field.EmailField label={t('register.email')} placeholder={t('register.emailPlaceholder')} autoComplete="email" />}</form.AppField>

        <form.AppField name="password">{(field) => <field.PasswordField label={t('register.password')} autoComplete="new-password" />}</form.AppField>

        <form.AppField name="passwordConfirm">{(field) => <field.PasswordField label={t('register.passwordConfirm')} autoComplete="new-password" />}</form.AppField>

        <form.AppForm>
          <form.SubscribeButton>{t('register.submit')}</form.SubscribeButton>
        </form.AppForm>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t('register.hasAccount')}{' '}
        <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('register.login')}
        </Link>
      </p>
    </>
  );
}
