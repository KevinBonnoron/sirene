import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LANGUAGES } from '@/constants/languages';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function LanguagePicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('voice.language')}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((lang) => (
            <SelectItem key={lang.value} value={lang.value}>
              {lang.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
