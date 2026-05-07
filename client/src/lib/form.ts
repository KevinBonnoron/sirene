import { createFormHook } from '@tanstack/react-form';
import type { ZodError, ZodType } from 'zod';
import { EmailField } from '@/components/atoms/email-field';
import { InputField } from '@/components/atoms/input-field';
import { PasswordField } from '@/components/atoms/password-field';
import { SubscribeButton } from '@/components/atoms/subscribe-button';
import { fieldContext, formContext } from './form-contexts';

function zodFieldErrors(error: ZodError): Record<string, string> {
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

/** Wrap a zod schema as a tanstack-form `validators.onSubmit` callback. Maps
 *  zod issues onto per-field error records the way the form atoms expect. */
export function zodValidator<T>(schema: ZodType<T>) {
  return ({ value }: { value: T }) => {
    const result = schema.safeParse(value);
    return result.success ? undefined : { fields: zodFieldErrors(result.error) };
  };
}

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
