import type { Voice, VoiceSample } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { AudioLines, Copy, Download, EllipsisVertical, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { voiceClient } from '@/clients/voice.client';
import { voiceCollection, voiceSampleCollection } from '@/collections';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useModels } from '@/hooks/use-models';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { DeleteVoiceButton } from './delete-voice-button';
import { DownloadVoiceButton } from './download-voice-button';
import { VoiceDialog } from './voice-dialog';

interface Props {
  voice: Voice;
  selected?: boolean;
  onSelect: (id: string) => void;
  variant: 'bubble' | 'compact' | 'full';
  editOnClick?: boolean;
}

function BubbleVoiceItem({ voice, selected, onSelect, editOnClick }: Omit<Props, 'variant'>) {
  const avatarUrl = voice.avatar ? pb.files.getURL(voice, voice.avatar) : undefined;
  const [showEdit, setShowEdit] = useState(false);
  const { user } = useAuth();
  const isOwner = voice.user === user?.id;

  const handleClick = editOnClick && isOwner ? () => setShowEdit(true) : () => onSelect(voice.id);

  return (
    <>
      <button type="button" onClick={handleClick} className="flex flex-col items-center gap-1">
        <Avatar className={cn('size-12 transition-all', selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}>
          <AvatarImage src={avatarUrl} alt={voice.name} />
          <AvatarFallback className="text-sm">{voice.name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="w-14 truncate text-center text-[10px] text-muted-foreground">{voice.name}</span>
      </button>
      {showEdit && <VoiceDialog voice={voice} open={showEdit} onOpenChange={setShowEdit} />}
    </>
  );
}

function CompactVoiceItem({ voice, selected, onSelect, editOnClick }: Omit<Props, 'variant'>) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOwner = voice.user === user?.id;
  const avatarUrl = voice.avatar ? pb.files.getURL(voice, voice.avatar) : undefined;
  const [showEdit, setShowEdit] = useState(false);

  const handleClick = editOnClick && isOwner ? () => setShowEdit(true) : () => onSelect(voice.id);

  return (
    <div className={cn('group relative flex w-full items-center rounded-lg border transition-colors hover:bg-accent/50', selected && 'border-primary bg-primary/5 ring-1 ring-primary/50')}>
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 p-2 text-left" onClick={handleClick}>
        <Avatar className="size-8 shrink-0">
          <AvatarImage src={avatarUrl} alt={voice.name} />
          <AvatarFallback className="text-xs">{voice.name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{voice.name}</p>
          {voice.language && (
            <Badge variant="secondary" className="mt-0.5 px-1.5 py-0 text-[10px]">
              {voice.language}
            </Badge>
          )}
        </div>
      </button>

      <div className="pr-1 opacity-0 transition-opacity group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6">
              <EllipsisVertical className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                navigator.clipboard.writeText(voice.id);
                toast.success(t('voice.idCopied'));
              }}
            >
              <Copy className="size-4" /> {t('voice.copyId')}
            </DropdownMenuItem>
            {isOwner && (
              <DropdownMenuItem onSelect={() => setShowEdit(true)}>
                <Pencil className="size-4" /> {t('common.edit')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={async () => {
                try {
                  const blob = await voiceClient.exportZip(voice.id);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `voice-${voice.name.replace(/\s+/g, '-').toLowerCase()}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch {
                  toast.error(t('voice.exportFailed'));
                }
              }}
            >
              <Download className="size-4" /> {t('common.download')}
            </DropdownMenuItem>
            {isOwner && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  voiceCollection.delete(voice.id);
                }}
              >
                <Trash2 className="size-4" /> {t('common.delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {showEdit && <VoiceDialog voice={voice} open={showEdit} onOpenChange={setShowEdit} />}
    </div>
  );
}

function FullVoiceItem({ voice, selected, onSelect, editOnClick }: Omit<Props, 'variant'>) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOwner = voice.user === user?.id;
  const avatarUrl = voice.avatar ? pb.files.getURL(voice, voice.avatar) : undefined;
  const { catalog } = useModels();
  const selectedModel = catalog.find((m) => m.id === voice.model);
  const { data: allSamples } = useLiveQuery((q) => q.from({ voice_samples: voiceSampleCollection }));
  const sampleCount = selectedModel?.types.includes('cloning') ? allSamples?.filter((s: VoiceSample) => s.voice === voice.id).length : undefined;
  const [showEdit, setShowEdit] = useState(false);

  const handleClick = editOnClick && isOwner ? () => setShowEdit(true) : () => onSelect(voice.id);

  return (
    <Card
      className={cn('cursor-pointer py-3 transition-colors hover:bg-accent/50', selected && 'border-primary bg-primary/5 ring-1 ring-primary/50')}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-0">
        <Avatar className="size-10">
          <AvatarImage src={avatarUrl} alt={voice.name} />
          <AvatarFallback>{voice.name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <CardTitle className="text-base">{voice.name}</CardTitle>
          {voice.description && <p className="line-clamp-1 text-xs text-muted-foreground">{voice.description}</p>}
        </div>
        <CardAction className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(voice.id);
              toast.success(t('voice.idCopied'));
            }}
          >
            <Copy className="size-3.5" />
          </Button>
          <DownloadVoiceButton voice={voice} />
          {isOwner && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEdit(true);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <DeleteVoiceButton voiceId={voice.id} voiceName={voice.name} />
            </>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {voice.language && <Badge variant="secondary">{voice.language}</Badge>}
        {selectedModel?.name && <Badge variant="outline">{selectedModel.name}</Badge>}
        {sampleCount != null && (
          <Badge variant="outline" className="gap-1">
            <AudioLines className="size-3" />
            {sampleCount}
          </Badge>
        )}
      </CardContent>
      {showEdit && <VoiceDialog voice={voice} open={showEdit} onOpenChange={setShowEdit} />}
    </Card>
  );
}

export function VoiceItem({ variant, editOnClick, ...props }: Props) {
  switch (variant) {
    case 'bubble':
      return <BubbleVoiceItem {...props} editOnClick={editOnClick} />;
    case 'compact':
      return <CompactVoiceItem {...props} editOnClick={editOnClick} />;
    case 'full':
      return <FullVoiceItem {...props} editOnClick={editOnClick} />;
  }
}
