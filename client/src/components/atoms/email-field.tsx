import { InputField } from './input-field';

interface Props {
  label: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}

export function EmailField(props: Props) {
  return <InputField type="text" {...props} />;
}
