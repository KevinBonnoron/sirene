import { createFormHookContexts } from '@tanstack/react-form';

// Separate module: form.ts imports the field atoms, which need these contexts (import cycle otherwise).
export const { fieldContext, useFieldContext, formContext, useFormContext } = createFormHookContexts();
