import type { Voice, VoiceSample } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Globe, Loader2, Trash2, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { transcribeClient } from '@/clients/transcribe.client';
import { voiceCollection, voiceSampleCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { LANGUAGES } from '@/constants/languages';
import { useModels } from '@/hooks/use-models';
import { getCurrentUserId } from '@/lib/auth-interceptor';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';
import { AvatarPicker } from './voice-dialog/avatar-picker';
import { getNextSampleId, makeInitialState, voiceFormReducer } from './voice-dialog/state';
import { VoiceModelPicker } from './voice-dialog/voice-model-picker';
import { VoiceSampleSection } from './voice-dialog/voice-sample-section';

interface VoiceDialogProps {
  voice?: Voice;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function VoiceDialog({ voice, trigger, open: controlledOpen, onOpenChange: controlledOnOpenChange }: VoiceDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!voice;
  const sampleInputRef = useRef<HTMLInputElement>(null);

  const [state, dispatch] = useReducer(voiceFormReducer, makeInitialState(voice));
  const { internalOpen, loading, name, description, language, modelId, presetVoice, avatarFile, clearAvatar, pendingSamples, deletedSampleIds, tags, tagInput, isPublic } = state;

  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? ((v: boolean) => dispatch({ type: 'setOpen', value: v }));

  const { catalog, installations } = useModels();
  const installedModels = catalog.filter((m) => !m.types.includes('transcription') && !m.types.every((type) => type === 'design')).filter((m) => installations?.some((i) => i.id === m.id && i.status === 'installed'));
  const selectedCatalog = installedModels.find((m) => m.id === modelId);

  const { data: allSamples } = useLiveQuery((q) => q.from({ voice_samples: voiceSampleCollection }).orderBy(({ voice_samples }) => voice_samples.order, 'asc'));
  const existingSamples = allSamples?.filter((s: VoiceSample) => s.voice === voice?.id && !deletedSampleIds.includes(s.id));

  const { data: allVoices } = useLiveQuery((q) => q.from({ voices: voiceCollection }));
  const allExistingTags = useMemo(() => [...new Set((allVoices ?? []).flatMap((v) => v.tags ?? []))].sort(), [allVoices]);

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

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && voice) {
      dispatch({ type: 'resetForm', voice });
    }
    if (!nextOpen) {
      dispatch({ type: 'resetTransient' });
      if (!isEdit) {
        dispatch({ type: 'resetForm' });
      }
    }
  }

  function handleAddSampleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) {
      return;
    }
    const newSamples = Array.from(files).map((file) => ({ id: getNextSampleId(), file, transcript: '', transcribing: false }));
    dispatch({ type: 'addPendingSamples', samples: newSamples });
    if (sampleInputRef.current) {
      sampleInputRef.current.value = '';
    }
  }

  async function transcribePendingSample(id: string) {
    const sample = pendingSamples.find((s) => s.id === id);
    if (!sample) {
      return;
    }
    dispatch({ type: 'setPendingSampleTranscribing', id, value: true });
    try {
      const formData = new FormData();
      formData.append('audio', sample.file);
      const result = await transcribeClient.transcribe(formData);
      dispatch({ type: 'updatePendingTranscript', id, transcript: result.text });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('voice.transcriptionFailed'));
    } finally {
      dispatch({ type: 'setPendingSampleTranscribing', id, value: false });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !modelId) {
      return;
    }

    dispatch({ type: 'setLoading', value: true });
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
      dispatch({ type: 'resetTransient' });
      if (!isEdit) {
        dispatch({ type: 'resetForm' });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.failedToSave'));
    } finally {
      dispatch({ type: 'setLoading', value: false });
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
          <DialogDescription className="sr-only">{isEdit ? t('voice.editTitle') : t('voice.createTitle')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col sm:min-h-0 sm:flex-1 sm:overflow-hidden">
          <div className="flex flex-col gap-6 sm:min-h-0 sm:flex-1 sm:flex-row sm:overflow-y-auto">
            {/* Left panel — Avatar, Name, Description */}
            <div className="space-y-4 sm:w-2/5">
              <AvatarPicker src={displayedAvatar} name={name} onFile={(file) => dispatch({ type: 'setAvatar', file })} onClear={() => dispatch({ type: 'clearAvatar' })} />
              <div className="space-y-2">
                <Label>{t('voice.name')}</Label>
                <Input value={name} onChange={(e) => dispatch({ type: 'setName', value: e.target.value })} placeholder={t('voice.namePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('voice.description')}</Label>
                <Textarea value={description} onChange={(e) => dispatch({ type: 'setDescription', value: e.target.value })} placeholder={t('voice.descriptionPlaceholder')} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>{t('voice.language')}</Label>
                <Select value={language} onValueChange={(v) => dispatch({ type: 'setLanguage', value: v })}>
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
                        <button type="button" onClick={() => dispatch({ type: 'setTags', tags: tags.filter((tg) => tg !== tag) })} className="ml-0.5 hover:text-destructive">
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
                    if (allExistingTags.includes(value.toLowerCase())) {
                      const newTag = value.trim().toLowerCase();
                      if (!tags.includes(newTag)) {
                        dispatch({ type: 'setTags', tags: [...tags, newTag] });
                      }
                      dispatch({ type: 'setTagInput', value: '' });
                    } else {
                      dispatch({ type: 'setTagInput', value });
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                      e.preventDefault();
                      const newTag = tagInput.trim().toLowerCase();
                      if (!tags.includes(newTag)) {
                        dispatch({ type: 'setTags', tags: [...tags, newTag] });
                      }
                      dispatch({ type: 'setTagInput', value: '' });
                    }
                  }}
                  placeholder={t('voice.tagsPlaceholder')}
                  className="h-8 text-sm"
                  list="tag-suggestions"
                />
                <datalist id="tag-suggestions">
                  {allExistingTags
                    .filter((tg) => !tags.includes(tg))
                    .map((tg) => (
                      <option key={tg} value={tg} />
                    ))}
                </datalist>
              </div>
              <button type="button" onClick={() => dispatch({ type: 'setIsPublic', value: !isPublic })} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors', isPublic ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent')}>
                <Globe className="size-4" />
                {t('auth.public')}
              </button>
            </div>

            <Separator orientation="vertical" className="hidden h-auto sm:block" />
            <Separator orientation="horizontal" className="sm:hidden" />

            {/* Right panel — Model, Voice, Samples */}
            <div className="flex flex-col gap-4 sm:min-h-0 sm:w-3/5">
              <VoiceModelPicker open={open} installedModels={installedModels} modelId={modelId} presetVoice={presetVoice} onModelChange={(id) => dispatch({ type: 'setModelId', value: id })} onPresetVoiceChange={(id) => dispatch({ type: 'setPresetVoice', value: id })} />

              {selectedCatalog?.types.includes('cloning') && (
                <VoiceSampleSection
                  existingSamples={existingSamples}
                  pendingSamples={pendingSamples}
                  cumulativeDurations={cumulativeDurations}
                  totalDuration={totalDuration}
                  maxReferenceDuration={selectedCatalog.maxReferenceDuration ?? 25}
                  sampleInputRef={sampleInputRef}
                  onDeleteSample={(id) => dispatch({ type: 'addDeletedSample', id })}
                  onRemovePending={(id) => dispatch({ type: 'removePendingSample', id })}
                  onTranscriptChange={(id, transcript) => dispatch({ type: 'updatePendingTranscript', id, transcript })}
                  onTranscribe={transcribePendingSample}
                  onAddSamplesClick={() => sampleInputRef.current?.click()}
                  onAddSampleFiles={handleAddSampleFiles}
                />
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
