import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CatalogModel, PresetVoice, Voice, VoiceSample } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AudioLines, Globe, GripVertical, Info, Loader2, Pencil, Plus, Trash2, Volume2, VolumeOff, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { transcribeClient } from '@/clients/transcribe.client';
import { voiceCollection, voiceSampleCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useModels } from '@/hooks/use-models';
import { getCurrentUserId } from '@/lib/auth-interceptor';
import { LANGUAGES } from '@/lib/languages';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';
import { Waveform } from './waveform';

interface PendingSample {
  id: string;
  file: File;
  transcript: string;
  transcribing: boolean;
}

function AvatarPicker({ src, name, onFile, onClear }: { src?: string; name: string; onFile: (file: File) => void; onClear: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="group/avatar-btn relative flex justify-center">
      <button type="button" className="relative cursor-pointer" onClick={() => inputRef.current?.click()}>
        <Avatar className="size-24">
          <AvatarImage src={src} alt={name} />
          <AvatarFallback className="text-3xl">{name ? name.charAt(0).toUpperCase() : '?'}</AvatarFallback>
        </Avatar>
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover/avatar-btn:opacity-100">
          <Pencil className="size-5 text-white" />
        </div>
      </button>
      {src && (
        <button type="button" className="bg-destructive text-destructive-foreground absolute bottom-0 right-1/2 translate-x-[2.5rem] flex size-5 items-center justify-center rounded-full" onClick={onClear}>
          <X className="size-3" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            onFile(f);
          }
        }}
      />
    </div>
  );
}

function getDurationColor(cumulativeDuration: number, maxDuration: number) {
  if (cumulativeDuration > maxDuration) {
    return 'border-l-red-500';
  }
  if (cumulativeDuration > maxDuration * 0.8) {
    return 'border-l-amber-500';
  }
  return 'border-l-green-500';
}

function SortableSampleItem({ sample, cumulativeDuration, maxDuration, onToggleEnabled, onDelete }: { sample: VoiceSample; cumulativeDuration: number; maxDuration: number; onToggleEnabled: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sample.id });
  const enabled = sample.enabled !== false;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn('space-y-1 rounded-md border border-l-4 p-2', enabled ? getDurationColor(cumulativeDuration, maxDuration) : 'border-l-muted', isDragging && 'opacity-50', !enabled && 'opacity-40')}>
      <div className="flex items-center gap-2">
        <button type="button" className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground" {...attributes} {...listeners}>
          <GripVertical className="size-3.5" />
        </button>
        <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground" onClick={onToggleEnabled}>
          {enabled ? <Volume2 className="size-3.5" /> : <VolumeOff className="size-3.5" />}
        </Button>
        <Waveform src={pb.files.getURL(sample, sample.audio)} height={32} />
        <span className="shrink-0 text-[10px] text-muted-foreground">{sample.duration ? `${sample.duration.toFixed(1)}s` : ''}</span>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {sample.transcript && <p className="line-clamp-1 pl-6 text-xs text-muted-foreground">{sample.transcript}</p>}
    </div>
  );
}

let nextSampleId = 0;

interface VoiceDialogProps {
  voice?: Voice;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function VoiceDialog({ voice, trigger, open: controlledOpen, onOpenChange: controlledOnOpenChange }: VoiceDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!voice;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(voice?.name ?? '');
  const [description, setDescription] = useState(voice?.description ?? '');
  const [language, setLanguage] = useState(voice?.language ?? 'en');
  const [modelId, setModelId] = useState(voice?.model ?? '');
  const [presetVoice, setPresetVoice] = useState((voice?.options?.presetVoice as string) ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [clearAvatar, setClearAvatar] = useState(false);
  const [pendingSamples, setPendingSamples] = useState<PendingSample[]>([]);
  const [deletedSampleIds, setDeletedSampleIds] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>(voice?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [isPublic, setIsPublic] = useState(voice?.public ?? false);
  const sampleInputRef = useRef<HTMLInputElement>(null);

  const { catalog, installations } = useModels();
  const installedModels = catalog.filter((m) => !m.types.includes('transcription') && !m.types.every((t) => t === 'design')).filter((m) => installations?.some((i) => i.id === m.id && i.status === 'installed'));
  const selectedCatalog = installedModels.find((m) => m.id === modelId);

  // Group installed models by backend
  const backendGroups = useMemo(() => {
    const groupMap = new Map<string, CatalogModel[]>();
    for (const m of installedModels) {
      const list = groupMap.get(m.backend) ?? [];
      list.push(m);
      groupMap.set(m.backend, list);
    }
    return [...groupMap.entries()]
      .map(([backend, models]) => {
        const types = [...new Set(models.flatMap((m) => m.types))];
        return {
          backend,
          displayName: models[0].backendDisplayName ?? backend,
          types,
          models,
        };
      })
      .sort((a, b) => {
        const order = { preset: 0, api: 1, cloning: 2 };
        const aOrder = Math.min(...a.types.map((t) => order[t as keyof typeof order] ?? 3));
        const bOrder = Math.min(...b.types.map((t) => order[t as keyof typeof order] ?? 3));
        return aOrder - bOrder;
      });
  }, [installedModels]);

  const selectedBackend = selectedCatalog?.backend ?? null;

  // For API models, fetch voices dynamically; for preset models, use static presetVoices
  const {
    data: apiVoices,
    isLoading: apiVoicesLoading,
    error: apiVoicesError,
  } = useQuery({
    queryKey: ['model-voices', modelId],
    queryFn: () => modelClient.voices(modelId),
    enabled: !!selectedCatalog?.types.includes('api') && !!modelId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const availableVoices: PresetVoice[] = selectedCatalog?.types.includes('api') ? (apiVoices ?? []) : (selectedCatalog?.presetVoices ?? []);

  const { data: allSamples } = useLiveQuery((q) => q.from({ voice_samples: voiceSampleCollection }).orderBy(({ voice_samples }) => voice_samples.order, 'asc'));
  const existingSamples = allSamples?.filter((s: VoiceSample) => s.voice === voice?.id && !deletedSampleIds.includes(s.id));

  const { data: allVoices } = useLiveQuery((q) => q.from({ voices: voiceCollection }));
  const allExistingTags = useMemo(() => [...new Set((allVoices ?? []).flatMap((v) => v.tags ?? []))].sort(), [allVoices]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const totalDuration = useMemo(() => (existingSamples ?? []).filter((s) => s.enabled !== false).reduce((acc, s) => acc + (s.duration || 0), 0), [existingSamples]);

  const cumulativeDurations = useMemo(() => {
    let cumul = 0;
    return (existingSamples ?? []).map((s) => {
      if (s.enabled !== false) {
        cumul += s.duration || 0;
      }
      return cumul;
    });
  }, [existingSamples]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !existingSamples || !voice) {
      return;
    }

    const oldIndex = existingSamples.findIndex((s) => s.id === active.id);
    const newIndex = existingSamples.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reordered = [...existingSamples];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    for (let i = 0; i < reordered.length; i++) {
      voiceSampleCollection.update(reordered[i].id, (draft) => {
        draft.order = i;
      });
    }
  }

  const avatarPreview = useMemo(() => (avatarFile ? URL.createObjectURL(avatarFile) : undefined), [avatarFile]);
  const avatarUrl = voice?.avatar ? pb.files.getURL(voice, voice.avatar) : undefined;
  const displayedAvatar = clearAvatar ? undefined : (avatarPreview ?? avatarUrl);

  useEffect(() => {
    return () => {
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  useEffect(() => {
    if (open && !modelId && installedModels.length === 1) {
      setModelId(installedModels[0].id);
    }
  }, [open, modelId, installedModels]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && voice) {
      setName(voice.name);
      setDescription(voice.description);
      setLanguage(voice.language || 'en');
      setModelId(voice.model || '');
      setPresetVoice((voice.options?.presetVoice as string) || '');
      setTags(voice.tags ?? []);
    }
    if (!nextOpen) {
      setAvatarFile(null);
      setClearAvatar(false);
      setPendingSamples([]);
      setDeletedSampleIds([]);
      setTagInput('');
      if (!isEdit) {
        setName('');
        setDescription('');
        setLanguage('en');
        setModelId('');
        setPresetVoice('');
        setTags([]);
      }
    }
  }

  function handleBackendSelect(backend: string) {
    const group = backendGroups.find((g) => g.backend === backend);
    if (!group) {
      return;
    }

    const currentInGroup = group.models.find((m) => m.id === modelId);
    const target = currentInGroup ?? group.models[0];

    setModelId(target.id);
    if (target.types.includes('preset') && target.presetVoices?.length === 1) {
      setPresetVoice(target.presetVoices[0].id);
    } else {
      setPresetVoice('');
    }
  }

  function handleAddSampleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) {
      return;
    }
    const newSamples = Array.from(files).map((file) => ({ id: `pending-${nextSampleId++}`, file, transcript: '', transcribing: false }));
    setPendingSamples((prev) => [...prev, ...newSamples]);
    if (sampleInputRef.current) {
      sampleInputRef.current.value = '';
    }
  }

  function removePendingSample(id: string) {
    setPendingSamples((prev) => prev.filter((s) => s.id !== id));
  }

  function updatePendingTranscript(id: string, transcript: string) {
    setPendingSamples((prev) => prev.map((s) => (s.id === id ? { ...s, transcript } : s)));
  }

  async function transcribePendingSample(id: string) {
    const sample = pendingSamples.find((s) => s.id === id);
    if (!sample) {
      return;
    }
    setPendingSamples((prev) => prev.map((s) => (s.id === id ? { ...s, transcribing: true } : s)));
    try {
      const formData = new FormData();
      formData.append('audio', sample.file);
      const result = await transcribeClient.transcribe(formData);
      setPendingSamples((prev) => prev.map((s) => (s.id === id ? { ...s, transcript: result.text, transcribing: false } : s)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('voice.transcriptionFailed'));
      setPendingSamples((prev) => prev.map((s) => (s.id === id ? { ...s, transcribing: false } : s)));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !modelId) {
      return;
    }

    setLoading(true);
    try {
      const options: Record<string, unknown> = {};
      if ((selectedCatalog?.types.includes('preset') || selectedCatalog?.types.includes('api')) && presetVoice) {
        options.presetVoice = presetVoice;
      }

      const formData = new FormData();
      formData.append('name', name);
      formData.append('description', description);
      formData.append('language', language);
      formData.append('model', modelId);
      formData.append('options', JSON.stringify(options));
      formData.append('tags', JSON.stringify(tags));
      formData.append('public', String(isPublic));
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      } else if (clearAvatar && isEdit) {
        formData.append('avatar', '');
      }

      let voiceId: string;
      let createdNew = false;
      if (isEdit) {
        await pb.collection('voices').update(voice.id, formData);
        voiceId = voice.id;
      } else {
        const userId = getCurrentUserId();
        if (userId) {
          formData.append('user', userId);
        }
        const created = await pb.collection('voices').create(formData);
        voiceId = created.id;
        createdNew = true;
      }

      // Delete removed samples & upload new ones in parallel
      try {
        await Promise.all([
          ...deletedSampleIds.map((sampleId) => voiceSampleCollection.delete(sampleId).isPersisted.promise),
          ...pendingSamples.map((sample) => {
            const sampleForm = new FormData();
            sampleForm.append('voice', voiceId);
            sampleForm.append('audio', sample.file);
            sampleForm.append('transcript', sample.transcript);
            sampleForm.append('enabled', 'true');
            sampleForm.append('order', '0');
            return pb.collection('voice_samples').create(sampleForm);
          }),
        ]);
      } catch (sampleErr) {
        if (createdNew) {
          await voiceCollection.delete(voiceId).isPersisted.promise.catch(() => {});
        }
        throw sampleErr;
      }

      setOpen(false);
      setAvatarFile(null);
      setClearAvatar(false);
      setPendingSamples([]);
      setDeletedSampleIds([]);
      if (!isEdit) {
        setName('');
        setDescription('');
        setLanguage('en');
        setModelId('');
        setPresetVoice('');
        setIsPublic(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.failedToSave'));
    } finally {
      setLoading(false);
    }
  }

  const needsPreset = selectedCatalog?.types.includes('preset') || selectedCatalog?.types.includes('api');
  const canSubmit = !loading && !!name.trim() && !!modelId && (!needsPreset || !!presetVoice);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-4xl sm:max-h-[85vh] flex flex-col sm:flex sm:overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('voice.editTitle') : t('voice.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col sm:min-h-0 sm:flex-1 sm:overflow-hidden">
          <div className="flex flex-col gap-6 sm:min-h-0 sm:flex-1 sm:flex-row sm:overflow-y-auto">
            {/* Left panel — Avatar, Name, Description */}
            <div className="space-y-4 sm:w-2/5">
              <AvatarPicker
                src={displayedAvatar}
                name={name}
                onFile={(file) => {
                  setAvatarFile(file);
                  setClearAvatar(false);
                }}
                onClear={() => {
                  setAvatarFile(null);
                  setClearAvatar(true);
                }}
              />
              <div className="space-y-2">
                <Label>{t('voice.name')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('voice.namePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('voice.description')}</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('voice.descriptionPlaceholder')} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>{t('voice.language')}</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="w-full">
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
              <div className="space-y-2">
                <Label>{t('voice.tags')}</Label>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        {tag}
                        <button type="button" onClick={() => setTags(tags.filter((t) => t !== tag))} className="ml-0.5 hover:text-destructive">
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <Input
                  value={tagInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    // When a datalist option is selected, the value is set directly — add it as a tag
                    if (allExistingTags.includes(value.toLowerCase())) {
                      const newTag = value.trim().toLowerCase();
                      if (!tags.includes(newTag)) {
                        setTags([...tags, newTag]);
                      }
                      setTagInput('');
                    } else {
                      setTagInput(value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                      e.preventDefault();
                      const newTag = tagInput.trim().toLowerCase();
                      if (!tags.includes(newTag)) {
                        setTags([...tags, newTag]);
                      }
                      setTagInput('');
                    }
                  }}
                  placeholder={t('voice.tagsPlaceholder')}
                  className="h-8 text-sm"
                  list="tag-suggestions"
                />
                <datalist id="tag-suggestions">
                  {allExistingTags
                    .filter((t) => !tags.includes(t))
                    .map((t) => (
                      <option key={t} value={t} />
                    ))}
                </datalist>
              </div>
              <button type="button" onClick={() => setIsPublic(!isPublic)} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors', isPublic ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent')}>
                <Globe className="size-4" />
                {t('auth.public')}
              </button>
            </div>

            <Separator orientation="vertical" className="hidden h-auto sm:block" />
            <Separator orientation="horizontal" className="sm:hidden" />

            {/* Right panel — Model, Voice, Language, Samples */}
            <div className="flex flex-col gap-4 sm:min-h-0 sm:w-3/5">
              <div className="space-y-2">
                <Label>{t('voice.model')}</Label>
                {installedModels.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
                    <p className="text-sm text-muted-foreground">{t('voice.noModels')}</p>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/models">{t('voice.installModel')}</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {backendGroups.map((group) => (
                      <button
                        key={group.backend}
                        type="button"
                        onClick={() => handleBackendSelect(group.backend)}
                        className={cn('flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent/50', selectedBackend === group.backend && 'border-primary bg-primary/5 ring-1 ring-primary/50')}
                      >
                        <span className="text-sm font-medium">{group.displayName}</span>
                        <div className="flex gap-1">
                          {group.types.map((type) => (
                            <Badge key={type} variant="outline" className={cn('px-1.5 py-0 text-[10px]', type === 'preset' ? 'border-blue-500/50 text-blue-600 dark:text-blue-400' : type === 'api' ? 'border-cyan-500/50 text-cyan-600 dark:text-cyan-400' : type === 'design' ? 'border-amber-500/50 text-amber-600 dark:text-amber-400' : 'border-purple-500/50 text-purple-600 dark:text-purple-400')}>
                              {type === 'preset' ? t('voice.preset') : type === 'api' ? t('voice.cloud') : type === 'design' ? t('voice.voiceDesign') : t('voice.cloning')}
                            </Badge>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Variant selector — shown when the backend has multiple models */}
              {selectedBackend &&
                (() => {
                  const group = backendGroups.find((g) => g.backend === selectedBackend);
                  const variants = group && group.models.length > 1 ? group.models : null;
                  return variants ? (
                    <div className="space-y-2">
                      <Label>{t('voice.variant')}</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {variants.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setModelId(m.id);
                              setPresetVoice('');
                            }}
                            className={cn('rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent/50', modelId === m.id && 'border-primary bg-primary/10 text-primary')}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

              {/* Preset voice selector */}
              {(selectedCatalog?.types.includes('preset') || selectedCatalog?.types.includes('api')) && (
                <div className="space-y-2">
                  <Label>{t('voice.voice')}</Label>
                  {apiVoicesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> {t('voice.loadingVoices')}
                    </div>
                  ) : availableVoices.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {availableVoices.map((pv) => (
                        <button key={pv.id} type="button" title={pv.description} onClick={() => setPresetVoice(pv.id)} className={cn('rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent/50', presetVoice === pv.id && 'border-primary bg-primary/10 text-primary')}>
                          {pv.label}
                        </button>
                      ))}
                    </div>
                  ) : apiVoicesError ? (
                    <p className="text-sm text-destructive">{apiVoicesError instanceof Error ? apiVoicesError.message : t('voice.failedToLoadVoices')}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('voice.noVoices')}</p>
                  )}
                </div>
              )}

              {selectedCatalog?.types.includes('cloning') && (
                <div className="flex flex-col gap-3 sm:min-h-0 sm:flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Label>{t('voice.audioSamples')}</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-64 text-xs">
                          {t('voice.audioSamplesHint')}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {totalDuration > 0 && <span className="text-[10px] text-muted-foreground">{t('voice.totalDuration', { duration: totalDuration.toFixed(1), max: selectedCatalog?.maxReferenceDuration ?? 25 })}</span>}
                  </div>

                  <div className="space-y-2 sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
                    {/* Existing samples — sortable */}
                    {existingSamples && existingSamples.length > 0 && (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={existingSamples.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                          <div className="space-y-2">
                            {existingSamples.map((sample, i) => (
                              <SortableSampleItem
                                key={sample.id}
                                sample={sample}
                                cumulativeDuration={cumulativeDurations[i]}
                                maxDuration={selectedCatalog?.maxReferenceDuration ?? 25}
                                onToggleEnabled={() =>
                                  voiceSampleCollection.update(sample.id, (draft) => {
                                    draft.enabled = sample.enabled === false;
                                  })
                                }
                                onDelete={() => setDeletedSampleIds((prev) => [...prev, sample.id])}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}

                    {/* Pending samples (new uploads) */}
                    {pendingSamples.map((sample) => (
                      <div key={sample.id} className="space-y-2 rounded-md border border-dashed p-2">
                        <div className="flex items-center justify-between">
                          <span className="truncate text-xs font-medium">{sample.file.name}</span>
                          <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => removePendingSample(sample.id)}>
                            <X className="size-3.5" />
                          </Button>
                        </div>
                        <Waveform src={sample.file} height={32} />
                        <div className="flex gap-1.5">
                          <Textarea value={sample.transcript} onChange={(e) => updatePendingTranscript(sample.id, e.target.value)} placeholder={t('voice.pendingTranscriptPlaceholder')} rows={1} className="min-h-0 flex-1 text-xs" />
                          <Button type="button" variant="outline" size="icon" className="size-7 shrink-0" onClick={() => transcribePendingSample(sample.id)} disabled={sample.transcribing}>
                            {sample.transcribing ? <Loader2 className="size-3 animate-spin" /> : <AudioLines className="size-3" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button type="button" variant="outline" size="sm" className="w-full shrink-0" onClick={() => sampleInputRef.current?.click()}>
                    <Plus className="size-3.5" />
                    {t('voice.addAudioSample')}
                  </Button>
                  <input ref={sampleInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={handleAddSampleFiles} />
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 grid grid-cols-1 gap-2 border-t pt-4 mt-4 sm:flex sm:justify-end">
            {isEdit && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive hover:text-destructive sm:mr-auto">
                    <Trash2 className="size-4" /> {t('common.delete')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('voice.deleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('voice.deleteConfirm', { name: voice?.name })}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => {
                        if (voice) {
                          voiceCollection.delete(voice.id);
                        }
                        setOpen(false);
                      }}
                    >
                      {t('common.delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t('common.saving')}
                </>
              ) : isEdit ? (
                t('common.save')
              ) : (
                t('common.create')
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
