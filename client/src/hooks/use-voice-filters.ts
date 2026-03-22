import type { Voice } from '@sirene/shared';
import { useMemo, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';

type VisibilityFilter = 'all' | 'mine' | 'public';

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
