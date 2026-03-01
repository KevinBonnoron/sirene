import type { Voice } from '@sirene/shared';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModels } from '@/hooks/use-models';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

export type VisibilityFilter = 'all' | 'mine' | 'public';

export interface VoiceFilterProps {
  search: string;
  setSearch: (v: string) => void;
  visibilityFilter: VisibilityFilter;
  setVisibilityFilter: (v: VisibilityFilter) => void;
  languageFilter: string | null;
  setLanguageFilter: (v: string | null) => void;
  modelFilter: string | null;
  setModelFilter: (v: string | null) => void;
  tagFilters: string[];
  setTagFilters: (v: string[]) => void;
  languages: string[];
  models: string[];
  allTags: string[];
  hasPublicVoices: boolean;
}

export function useVoiceFilters(voices: Voice[] | undefined) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');
  const [languageFilter, setLanguageFilter] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [tagFilters, setTagFilters] = useState<string[]>([]);

  const languages = useMemo(() => {
    if (!voices) {
      return [];
    }

    return [...new Set(voices.map((v) => v.language).filter(Boolean))].sort();
  }, [voices]);

  const models = useMemo(() => {
    if (!voices) {
      return [];
    }

    return [...new Set(voices.map((v) => v.model).filter(Boolean))].sort();
  }, [voices]);

  const allTags = useMemo(() => {
    if (!voices) {
      return [];
    }

    return [...new Set(voices.flatMap((v) => v.tags ?? []))].sort();
  }, [voices]);

  const hasPublicVoices = useMemo(() => {
    if (!voices) {
      return false;
    }

    return voices.some((v) => v.public && v.user !== user?.id);
  }, [voices, user?.id]);

  const filteredVoices = useMemo(() => {
    if (!voices) {
      return [];
    }

    return voices.filter((v) => {
      const matchesSearch = !search || v.name.toLowerCase().includes(search.toLowerCase());
      const matchesVisibility = visibilityFilter === 'all' || (visibilityFilter === 'mine' && v.user === user?.id) || (visibilityFilter === 'public' && v.public && v.user !== user?.id);
      const matchesLanguage = !languageFilter || v.language === languageFilter;
      const matchesModel = !modelFilter || v.model === modelFilter;
      const matchesTags = tagFilters.length === 0 || tagFilters.every((tag) => v.tags?.includes(tag));
      return matchesSearch && matchesVisibility && matchesLanguage && matchesModel && matchesTags;
    });
  }, [voices, search, visibilityFilter, user?.id, languageFilter, modelFilter, tagFilters]);

  const filterProps: VoiceFilterProps = {
    search,
    setSearch,
    visibilityFilter,
    setVisibilityFilter,
    languageFilter,
    setLanguageFilter,
    modelFilter,
    setModelFilter,
    tagFilters,
    setTagFilters,
    languages,
    models,
    allTags,
    hasPublicVoices,
  };

  return { filteredVoices, filterProps };
}

type FilterType = 'search' | 'visibility' | 'language' | 'model' | 'tag';

interface FilterBadge {
  type: FilterType;
  value: string;
  label: string;
}

const badgeColors: Record<FilterType, string> = {
  search: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
  visibility: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  language: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  model: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  tag: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

const categoryLabels: Record<Exclude<FilterType, 'search'>, string> = {
  visibility: 'voice.visibility',
  language: 'voice.language',
  model: 'voice.model',
  tag: 'voice.tags',
};

interface SuggestionItem {
  type: FilterType;
  value: string;
  label: string;
}

export function VoiceFilterBar({ search, setSearch, visibilityFilter, setVisibilityFilter, languageFilter, setLanguageFilter, modelFilter, setModelFilter, tagFilters, setTagFilters, languages, models, allTags, hasPublicVoices }: VoiceFilterProps) {
  const { t } = useTranslation();
  const { catalog } = useModels();
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const getModelName = useCallback(
    (modelId: string) => {
      const m = catalog.find((c) => c.id === modelId);
      return m?.name ?? modelId;
    },
    [catalog],
  );

  // Build active badges
  const activeBadges: FilterBadge[] = useMemo(() => {
    const badges: FilterBadge[] = [];
    if (search) {
      badges.push({ type: 'search', value: search, label: `"${search}"` });
    }
    if (visibilityFilter !== 'all') {
      badges.push({ type: 'visibility', value: visibilityFilter, label: t(visibilityFilter === 'mine' ? 'voice.mine' : 'voice.public') });
    }
    if (languageFilter) {
      badges.push({ type: 'language', value: languageFilter, label: languageFilter });
    }
    if (modelFilter) {
      badges.push({ type: 'model', value: modelFilter, label: getModelName(modelFilter) });
    }
    for (const tag of tagFilters) {
      badges.push({ type: 'tag', value: tag, label: tag });
    }
    return badges;
  }, [search, visibilityFilter, languageFilter, modelFilter, tagFilters, t, getModelName]);

  // Build suggestions filtered by input text
  const suggestions = useMemo(() => {
    const query = inputValue.toLowerCase();
    const items: SuggestionItem[] = [];

    // Visibility
    if (hasPublicVoices && visibilityFilter === 'all') {
      const visOptions: { value: VisibilityFilter; labelKey: string }[] = [
        { value: 'mine', labelKey: 'voice.mine' },
        { value: 'public', labelKey: 'voice.public' },
      ];
      for (const opt of visOptions) {
        const label = t(opt.labelKey);
        if (!query || label.toLowerCase().includes(query)) {
          items.push({ type: 'visibility', value: opt.value, label });
        }
      }
    }

    // Languages
    if (languages.length > 1) {
      for (const lang of languages) {
        if (lang === languageFilter) {
          continue;
        }
        if (!query || lang.toLowerCase().includes(query)) {
          items.push({ type: 'language', value: lang, label: lang });
        }
      }
    }

    // Models
    if (models.length > 1) {
      for (const modelId of models) {
        if (modelId === modelFilter) {
          continue;
        }
        const name = getModelName(modelId);
        if (!query || name.toLowerCase().includes(query) || modelId.toLowerCase().includes(query)) {
          items.push({ type: 'model', value: modelId, label: name });
        }
      }
    }

    // Tags
    for (const tag of allTags) {
      if (tagFilters.includes(tag)) {
        continue;
      }
      if (!query || tag.toLowerCase().includes(query)) {
        items.push({ type: 'tag', value: tag, label: tag });
      }
    }

    return items;
  }, [inputValue, hasPublicVoices, visibilityFilter, languages, languageFilter, models, modelFilter, allTags, tagFilters, t, getModelName]);

  // Group suggestions by type for display
  const groupedSuggestions = useMemo(() => {
    const groups: { type: Exclude<FilterType, 'search'>; items: SuggestionItem[] }[] = [];
    const typeOrder: Exclude<FilterType, 'search'>[] = ['visibility', 'language', 'model', 'tag'];
    for (const type of typeOrder) {
      const items = suggestions.filter((s) => s.type === type);
      if (items.length > 0) {
        groups.push({ type, items });
      }
    }
    return groups;
  }, [suggestions]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    const el = listRef.current.querySelector(`[data-index="${highlightIndex}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  const selectSuggestion = (item: SuggestionItem) => {
    switch (item.type) {
      case 'visibility':
        setVisibilityFilter(item.value as VisibilityFilter);
        break;
      case 'language':
        setLanguageFilter(item.value);
        break;
      case 'model':
        setModelFilter(item.value);
        break;
      case 'tag':
        setTagFilters([...tagFilters, item.value]);
        break;
    }
    setInputValue('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const removeBadge = (badge: FilterBadge) => {
    switch (badge.type) {
      case 'search':
        setSearch('');
        break;
      case 'visibility':
        setVisibilityFilter('all');
        break;
      case 'language':
        setLanguageFilter(null);
        break;
      case 'model':
        setModelFilter(null);
        break;
      case 'tag':
        setTagFilters(tagFilters.filter((t) => t !== badge.value));
        break;
    }
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && suggestions.length > 0) {
        selectSuggestion(suggestions[highlightIndex]);
      } else if (inputValue.trim()) {
        setSearch(inputValue.trim());
        setInputValue('');
        setOpen(false);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && suggestions.length > 0) {
        setOpen(true);
      } else {
        setHighlightIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (e.key === 'Backspace' && !inputValue && activeBadges.length > 0) {
      removeBadge(activeBadges[activeBadges.length - 1]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setHighlightIndex(0);
    setOpen(value.length > 0 || suggestions.length > 0);
  };

  const flatIndex = (groupIdx: number, itemIdx: number) => {
    let idx = 0;
    for (let g = 0; g < groupIdx; g++) {
      idx += groupedSuggestions[g].items.length;
    }
    return idx + itemIdx;
  };

  const showDropdown = open && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div role="combobox" aria-expanded={showDropdown} tabIndex={-1} className={cn('flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-sm', 'cursor-text')} onClick={() => inputRef.current?.focus()} onKeyDown={() => inputRef.current?.focus()}>
        <Search className="size-3.5 shrink-0 text-muted-foreground" />

        {activeBadges.map((badge) => (
          <span key={`${badge.type}-${badge.value}`} className={cn('inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0 text-xs font-medium', badgeColors[badge.type])}>
            {badge.label}
            <button
              type="button"
              className="ml-0.5 rounded-sm opacity-70 hover:opacity-100 focus:outline-none"
              onClick={(e) => {
                e.stopPropagation();
                removeBadge(badge);
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) {
              setOpen(true);
            }
          }}
          placeholder={activeBadges.length === 0 ? t('voice.searchPlaceholder') : ''}
          className="min-w-[60px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </div>

      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
          <div ref={listRef} className="max-h-64 overflow-y-auto">
            {groupedSuggestions.map((group, gi) => (
              <div key={group.type}>
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t(categoryLabels[group.type])}</div>
                {group.items.map((item, ii) => {
                  const idx = flatIndex(gi, ii);
                  return (
                    <button
                      key={`${item.type}-${item.value}`}
                      data-index={idx}
                      type="button"
                      className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none', idx === highlightIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}
                      onMouseEnter={() => setHighlightIndex(idx)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSuggestion(item)}
                    >
                      <span className={cn('inline-block size-2 rounded-full', badgeColors[item.type].split(' ')[0])} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
