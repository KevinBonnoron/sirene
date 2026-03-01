import type { CatalogModel, PresetVoice } from '@sirene/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { modelClient } from '@/clients/model.client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  installedModels: CatalogModel[];
  modelId: string;
  presetVoice: string;
  onModelChange: (modelId: string) => void;
  onPresetVoiceChange: (voiceId: string) => void;
}

export function VoiceModelPicker({ open, installedModels, modelId, presetVoice, onModelChange, onPresetVoiceChange }: Props) {
  const { t } = useTranslation();

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
        return { backend, displayName: models[0].backendDisplayName ?? backend, types, models };
      })
      .sort((a, b) => {
        const order = { preset: 0, api: 1, cloning: 2 };
        const aOrder = Math.min(...a.types.map((type) => order[type as keyof typeof order] ?? 3));
        const bOrder = Math.min(...b.types.map((type) => order[type as keyof typeof order] ?? 3));
        return aOrder - bOrder;
      });
  }, [installedModels]);

  const selectedCatalog = installedModels.find((m) => m.id === modelId);
  const selectedBackend = selectedCatalog?.backend ?? null;

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

  useEffect(() => {
    if (open && !modelId && installedModels.length === 1) {
      onModelChange(installedModels[0].id);
    }
  }, [open, modelId, installedModels, onModelChange]);

  useEffect(() => {
    if (availableVoices.length === 1 && !presetVoice) {
      onPresetVoiceChange(availableVoices[0].id);
    }
  }, [availableVoices, presetVoice, onPresetVoiceChange]);

  function handleBackendSelect(backend: string) {
    const group = backendGroups.find((g) => g.backend === backend);
    if (!group) {
      return;
    }
    const currentInGroup = group.models.find((m) => m.id === modelId);
    const target = currentInGroup ?? group.models[0];
    onModelChange(target.id);
    if (target.types.includes('preset') && target.presetVoices?.length === 1) {
      onPresetVoiceChange(target.presetVoices[0].id);
    } else {
      onPresetVoiceChange('');
    }
  }

  const group = selectedBackend ? backendGroups.find((g) => g.backend === selectedBackend) : null;
  const variants = group && group.models.length > 1 ? group.models : null;

  return (
    <>
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
            {backendGroups.map((g) => (
              <button key={g.backend} type="button" onClick={() => handleBackendSelect(g.backend)} className={cn('flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent/50', selectedBackend === g.backend && 'border-primary bg-primary/5 ring-1 ring-primary/50')}>
                <span className="text-sm font-medium">{g.displayName}</span>
                <div className="flex gap-1">
                  {g.types.map((type) => (
                    <Badge
                      key={type}
                      variant="outline"
                      className={cn(
                        'px-1.5 py-0 text-[10px]',
                        type === 'preset' ? 'border-blue-500/50 text-blue-600 dark:text-blue-400' : type === 'api' ? 'border-cyan-500/50 text-cyan-600 dark:text-cyan-400' : type === 'design' ? 'border-amber-500/50 text-amber-600 dark:text-amber-400' : 'border-purple-500/50 text-purple-600 dark:text-purple-400',
                      )}
                    >
                      {type === 'preset' ? t('voice.preset') : type === 'api' ? t('voice.cloud') : type === 'design' ? t('voice.voiceDesign') : t('voice.cloning')}
                    </Badge>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {variants && (
        <div className="space-y-2">
          <Label>{t('voice.variant')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {variants.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onModelChange(m.id);
                  onPresetVoiceChange('');
                }}
                className={cn('rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent/50', modelId === m.id && 'border-primary bg-primary/10 text-primary')}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

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
                <button key={pv.id} type="button" title={pv.description} onClick={() => onPresetVoiceChange(pv.id)} className={cn('rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent/50', presetVoice === pv.id && 'border-primary bg-primary/10 text-primary')}>
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
    </>
  );
}
