import type { Voice } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { ChevronDown, Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { voiceCollection } from '@/collections';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useModels } from '@/hooks/use-models';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';

interface Props {
  voiceId: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}

export function TakeVoicePicker({ voiceId, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const { data: voices } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));
  const { catalog } = useModels();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = voices?.find((v) => v.id === voiceId);
  const filtered = voices?.filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase())) ?? [];

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSearch('');
    }
  }

  function select(voice: Voice) {
    onChange(voice.id);
    setOpen(false);
    setSearch('');
  }

  const triggerAvatar = selected?.avatar ? pb.files.getURL(selected, selected.avatar) : undefined;
  const triggerModel = selected ? catalog.find((m) => m.id === selected.model) : undefined;

  return (
    <Popover.Root open={open} onOpenChange={disabled ? undefined : handleOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" disabled={disabled} className={cn('group flex min-w-0 items-center gap-2 rounded transition-colors', disabled ? 'cursor-default opacity-70' : 'cursor-pointer hover:bg-muted/40')}>
          <Avatar className="size-6 shrink-0">
            <AvatarImage src={triggerAvatar} alt={selected?.name} />
            <AvatarFallback className="text-[10px]">{selected?.name.charAt(0).toUpperCase() ?? '?'}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate text-sm font-medium">{selected?.name ?? t('voice.selectVoice')}</span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">·</span>
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{triggerModel?.name ?? selected?.model ?? ''}</span>
          {!disabled && <ChevronDown className="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={16}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-50 w-72 rounded-md border bg-popover shadow-md outline-none"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input ref={inputRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('voice.searchPlaceholder')} className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="custom-scrollbar max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{t('voice.noMatch')}</p>
            ) : (
              filtered.map((v) => {
                const avatarUrl = v.avatar ? pb.files.getURL(v, v.avatar) : undefined;
                const modelName = catalog.find((m) => m.id === v.model)?.name;
                return (
                  <button key={v.id} type="button" onClick={() => select(v)} className={cn('flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-muted', voiceId === v.id && 'bg-muted/60')}>
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
