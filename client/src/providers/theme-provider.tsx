import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'dark' | 'light' | 'system';
export const ACCENTS = ['amber', 'sage', 'sky', 'violet', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  defaultAccent?: Accent;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function systemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children, defaultTheme = 'system', defaultAccent = 'amber', storageKey = 'sirene-theme' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStored(storageKey, ['dark', 'light', 'system'] as const, defaultTheme));
  const [accent, setAccentState] = useState<Accent>(() => readStored(`${storageKey}-accent`, ACCENTS, defaultAccent));
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => (theme === 'system' ? systemTheme() : theme));

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
      setResolvedTheme(resolved);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    window.document.documentElement.dataset.accent = accent;
  }, [accent]);

  const value = useMemo<ThemeProviderState>(
    () => ({
      theme,
      resolvedTheme,
      accent,
      setTheme: (next) => {
        writeStored(storageKey, next);
        setThemeState(next);
      },
      setAccent: (next) => {
        writeStored(`${storageKey}-accent`, next);
        setAccentState(next);
      },
    }),
    [theme, resolvedTheme, accent, storageKey],
  );

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
