import { createFormHookContexts } from '@tanstack/react-form';

// Lives in its own module so the form atoms (input-field, password-field, etc.)
// can read context without importing form.ts, which itself imports the atoms to
// register them as field/form components. Without this split, the imports cycle.
export const { fieldContext, useFieldContext, formContext, useFormContext } = createFormHookContexts();
