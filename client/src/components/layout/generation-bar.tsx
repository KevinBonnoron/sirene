import type { Voice } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { voiceCollection } from '@/collections';
import { GenerationInput } from '@/components/generation/generation-input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Waveform } from '@/components/voice/waveform';
import { useGenerate } from '@/hooks/use-generate';
import { useModels } from '@/hooks/use-models';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';

function VoiceCombobox({ voiceId, onChange }: { voiceId: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const { data: voices } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));
  const { catalog } = useModels();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedVoice = voices?.find((v) => v.id === voiceId);

  const filtered = voices?.filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase())) ?? [];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  function select(voice: Voice) {
    onChange(voice.id);
    setOpen(false);
    setSearch('');
  }

  const triggerAvatar = selectedVoice?.avatar ? pb.files.getURL(selectedVoice, selectedVoice.avatar) : undefined;

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <Avatar className="size-5 shrink-0">
          <AvatarImage src={triggerAvatar} alt={selectedVoice?.name} />
          <AvatarFallback className="text-[10px]">{selectedVoice?.name.charAt(0).toUpperCase() ?? '?'}</AvatarFallback>
        </Avatar>
        <span className="max-w-[120px] truncate font-medium">{selectedVoice?.name ?? t('voice.selectVoice')}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-md border bg-popover shadow-md">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input ref={inputRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('voice.searchPlaceholder')} className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{t('voice.noMatch')}</p>
            ) : (
              filtered.map((v) => {
                const avatarUrl = v.avatar ? pb.files.getURL(v, v.avatar) : undefined;
                const modelName = catalog.find((m) => m.id === v.model)?.name;
                return (
                  <button key={v.id} type="button" onClick={() => select(v)} className={cn('flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent', voiceId === v.id && 'bg-accent/60')}>
                    <Avatar className="size-7 shrink-0">
                      <AvatarImage src={avatarUrl} alt={v.name} />
                      <AvatarFallback className="text-xs">{v.name.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">{v.name}</p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {modelName && (
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">
                            {modelName}
                          </Badge>
                        )}
                        {v.language && (
                          <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                            {v.language}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GenerationBar() {
  const { data: voices } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));
  const { generate, isGenerating, lastAudioBlob } = useGenerate();
  const { catalog } = useModels();
  const [voiceId, setVoiceId] = useState('');

  useEffect(() => {
    if (!voices) {
      return;
    }
    if (!voiceId || !voices.find((v) => v.id === voiceId)) {
      setVoiceId(voices[0]?.id ?? '');
    }
  }, [voiceId, voices]);

  const selectedVoice = voices?.find((v) => v.id === voiceId);
  const selectedModel = selectedVoice ? catalog.find((m) => m.id === selectedVoice.model) : undefined;
  const capabilities = { tone: selectedModel?.supportsInstruct ?? false, effects: selectedModel?.supportsEffects ?? false };

  return (
    <div className="flex justify-center md:px-8 md:pb-10 md:pt-2 lg:px-16 lg:pb-16">
      <div className="w-full md:max-w-6xl">
        <div className="rounded-none md:rounded-xl shadow-2xl ring-2 ring-border/60 bg-card">
          <div className={`transition-opacity${isGenerating ? ' pointer-events-none opacity-50' : ''}`}>
            <GenerationInput voiceId={voiceId} generate={generate} isGenerating={isGenerating} capabilities={capabilities} voiceSelector={<VoiceCombobox voiceId={voiceId} onChange={setVoiceId} />} />
          </div>
          <div className="border-t px-3 py-2 h-11 flex items-center">{lastAudioBlob && <Waveform src={lastAudioBlob} autoPlay />}</div>
        </div>
      </div>
    </div>
  );
}
