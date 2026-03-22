import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFieldContext } from '@/lib/form';

interface PasswordFieldProps {
  label: string;
  autoComplete?: string;
  required?: boolean;
}

export function PasswordField({ label, autoComplete, required }: PasswordFieldProps) {
  const id = useId();
  const field = useFieldContext<string>();
  const [visible, setVisible] = useState(false);
  const errors = field.state.meta.errors.filter(Boolean);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={visible ? 'text' : 'password'} placeholder="••••••••" autoComplete={autoComplete} required={required} className="h-11 pr-10" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
        <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground" onClick={() => setVisible((v) => !v)}>
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </div>
      {errors.length > 0 && <p className="text-sm text-destructive">{errors.join(', ')}</p>}
    </div>
  );
}
