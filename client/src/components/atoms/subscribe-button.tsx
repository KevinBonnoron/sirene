import { useStore } from '@tanstack/react-store';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useFormContext } from '@/lib/form';

interface SubscribeButtonProps {
  children: ReactNode;
}

export function SubscribeButton({ children }: SubscribeButtonProps) {
  const form = useFormContext();
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  return (
    <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
      {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
      {children}
    </Button>
  );
}
