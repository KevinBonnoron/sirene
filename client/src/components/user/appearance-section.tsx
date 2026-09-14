import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ACCENTS, type Theme, useTheme } from '@/providers/theme-provider';

const MODES: { id: Theme; icon: typeof Sun }[] = [
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
  { id: 'system', icon: Monitor },
];

export function AppearanceSection() {
  const { t } = useTranslation();
  const { theme, setTheme, accent, setAccent } = useTheme();

  return (
    <>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium leading-none">{t('appearance.mode')}</legend>
        <div className="flex flex-wrap gap-2">
          {MODES.map(({ id, icon: Icon }) => (
            <Button key={id} type="button" variant={theme === id ? 'default' : 'outline'} size="sm" aria-pressed={theme === id} onClick={() => setTheme(id)}>
              <Icon className="size-4" />
              {t(`appearance.${id}`)}
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium leading-none">{t('appearance.accent')}</legend>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((value) => (
            <button
              key={value}
              type="button"
              data-accent={value}
              aria-label={t(`appearance.accents.${value}`)}
              title={t(`appearance.accents.${value}`)}
              aria-pressed={accent === value}
              onClick={() => setAccent(value)}
              className={cn('grid size-9 place-items-center rounded-full bg-primary text-primary-foreground ring-offset-2 ring-offset-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground', accent === value && 'ring-2 ring-foreground')}
            >
              {accent === value && <Check className="size-4" />}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
