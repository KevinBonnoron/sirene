import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFieldContext } from '@/lib/form';

interface Props {
  label: string;
  type?: 'text' | 'email';
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}

export function InputField({ label, type = 'text', placeholder, autoComplete, required }: Props) {
  const id = useId();
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors.filter(Boolean);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} placeholder={placeholder} autoComplete={autoComplete} required={required} className="h-11" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
      {errors.length > 0 && <p className="text-sm text-destructive">{errors.join(', ')}</p>}
    </div>
  );
}
