import { useTranslation } from 'react-i18next';
import { z } from 'zod';

export function useValidators() {
  const { t } = useTranslation();

  return {
    required: () => z.string().min(1, t('validators.required')),
    email: () =>
      z
        .string()
        .min(1, t('validators.required'))
        .refine((val) => z.email().safeParse(val).success, t('validators.emailInvalid')),
    minLength: (count: number) => z.string().min(count, t('validators.minLength', { count })),
    passwordMismatch: () => t('validators.passwordMismatch'),
  };
}
