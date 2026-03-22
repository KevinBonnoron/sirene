import { createFormHook, createFormHookContexts } from '@tanstack/react-form';
import type { ZodError } from 'zod';
import { EmailField } from '@/components/atoms/email-field';
import { InputField } from '@/components/atoms/input-field';
import { PasswordField } from '@/components/atoms/password-field';
import { SubscribeButton } from '@/components/atoms/subscribe-button';

export function zodFieldErrors(error: ZodError): Record<string, string> {
  return error.issues
    .filter((issue) => issue.path.length > 0)
    .reduce<Record<string, string>>((acc, issue) => {
      const key = String(issue.path[0]);
      if (!acc[key]) {
        acc[key] = issue.message;
      }
      return acc;
    }, {});
}

export const { fieldContext, useFieldContext, formContext, useFormContext } = createFormHookContexts();

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    InputField,
    EmailField,
    PasswordField,
  },
  formComponents: {
    SubscribeButton,
  },
});
