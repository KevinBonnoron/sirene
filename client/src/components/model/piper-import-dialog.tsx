import type { InferenceServer } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { inferenceServerCollection } from '@/collections';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useModels } from '@/hooks/use-models';
import { cn } from '@/lib/utils';
import { FileDrop } from '../atoms/file-drop';

type PiperState = {
  open: boolean;
  loading: boolean;
  name: string;
  onnxFile: File | null;
  configFile: File | null;
  configInfo: { voice: string; speakers: number; sampleRate: number } | null;
  selectedServerIds: string[];
};

type PiperAction =
  | { type: 'setOpen'; value: boolean }
  | { type: 'setLoading'; value: boolean }
  | { type: 'setName'; value: string }
  | { type: 'setOnnxFile'; file: File | null }
  | { type: 'setConfigFile'; file: File | null; info: PiperState['configInfo'] }
  | { type: 'setSelectedServerIds'; ids: string[] }
  | { type: 'reset' };

const piperInitial: PiperState = { open: false, loading: false, name: '', onnxFile: null, configFile: null, configInfo: null, selectedServerIds: [] };

function piperReducer(state: PiperState, action: PiperAction): PiperState {
  switch (action.type) {
    case 'setOpen':
      return { ...state, open: action.value };
    case 'setLoading':
      return { ...state, loading: action.value };
    case 'setName':
      return { ...state, name: action.value };
    case 'setOnnxFile':
      return { ...state, onnxFile: action.file };
    case 'setConfigFile':
      return { ...state, configFile: action.file, configInfo: action.info };
    case 'setSelectedServerIds':
      return { ...state, selectedServerIds: action.ids };
    case 'reset':
      return { ...piperInitial, open: false };
  }
}

const STATUS_DOT: Record<'online' | 'offline' | 'unknown' | '', string> = {
  online: 'bg-accent-sage',
  offline: 'bg-destructive',
  unknown: 'bg-muted-foreground/40',
  '': 'bg-muted-foreground/40',
};

function computeSlug(name: string, configInfo: PiperState['configInfo']): string | null {
  const speaker = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!speaker || !configInfo) {
    return null;
  }
  const [lang = '', region] = configInfo.voice.split('-');
  const locale = region ? `${lang.toLowerCase()}_${region.toUpperCase()}` : lang.toLowerCase();
  const quality = configInfo.sampleRate <= 16000 ? 'low' : 'medium';
  return `piper-${locale}-${speaker}-${quality}`;
}

export function PiperImportDialog() {
  const { t } = useTranslation();
  const [{ open, loading, name, onnxFile, configFile, configInfo, selectedServerIds }, dispatch] = useReducer(piperReducer, piperInitial);

  const { data: serversData } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }).where(({ s }) => s.enabled));
  const enabledServers = useMemo<InferenceServer[]>(() => serversData ?? [], [serversData]);
  const { installationsByName } = useModels();

  const slug = computeSlug(name, configInfo);
  const installedOnIds = useMemo<Set<string>>(() => {
    if (!slug) {
      return new Set();
    }
    return new Set(installationsByName.get(slug)?.serverIds ?? []);
  }, [slug, installationsByName]);

  // Submitted serverIds need to drop stale entries (offline or already-installed by the
  // time the user clicks Import). The UI already disables those rows, but `selectedServerIds`
  // is only updated on click/slug-change so it can lag behind the live server state.
  const effectiveSelectedServerIds = useMemo(() => {
    const byId = new Map(enabledServers.map((s) => [s.id, s]));
    return selectedServerIds.filter((id) => {
      const server = byId.get(id);
      return !!server && server.last_health_status !== 'offline' && !installedOnIds.has(id);
    });
  }, [enabledServers, installedOnIds, selectedServerIds]);

  const prevSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!slug || prevSlugRef.current === slug || enabledServers.length === 0) {
      return;
    }
    prevSlugRef.current = slug;
    const candidates = enabledServers.filter((s) => s.last_health_status === 'online' && !installedOnIds.has(s.id)).map((s) => s.id);
    dispatch({ type: 'setSelectedServerIds', ids: candidates });
  }, [slug, enabledServers, installedOnIds]);

  // Drop entries that became ineligible (offline or already installed) after selection
  // so the stored selection stays in sync with what the UI actually shows checked. The
  // dispatch is gated on a real change to avoid an update loop.
  useEffect(() => {
    if (effectiveSelectedServerIds.length === selectedServerIds.length) {
      return;
    }
    dispatch({ type: 'setSelectedServerIds', ids: effectiveSelectedServerIds });
  }, [effectiveSelectedServerIds, selectedServerIds.length]);

  // Guards stale `File.text()` resolutions. Fast successive drops can resolve out of
  // order, and the older read overwriting the newer file changes the derived slug and
  // submitted bytes silently.
  const latestConfigRead = useRef(0);

  function handleConfigFile(f: File | null) {
    if (!f) {
      latestConfigRead.current++;
      dispatch({ type: 'setConfigFile', file: null, info: null });
      return;
    }
    const readId = ++latestConfigRead.current;

    f.text().then((text) => {
      if (latestConfigRead.current !== readId) {
        return;
      }
      try {
        const data = JSON.parse(text);
        const voice = data?.espeak?.voice ?? 'unknown';
        const speakers = data?.num_speakers ?? 1;
        const sampleRate = data?.audio?.sample_rate ?? 22050;
        dispatch({ type: 'setConfigFile', file: f, info: { voice, speakers, sampleRate } });
      } catch {
        dispatch({ type: 'setConfigFile', file: f, info: null });
      }
    });
  }

  function toggleServer(id: string) {
    const next = selectedServerIds.includes(id) ? selectedServerIds.filter((x) => x !== id) : [...selectedServerIds, id];
    dispatch({ type: 'setSelectedServerIds', ids: next });
  }

  const isMultiServer = enabledServers.length > 1;
  // Single-server mode: the implicit target is the only server, but we must still
  // check it's actually usable (online and not already running this slug). Without
  // this guard, the form happily submits requests that the server will reject.
  const noTargets = (() => {
    if (enabledServers.length === 0) {
      return true;
    }
    if (isMultiServer) {
      return effectiveSelectedServerIds.length === 0;
    }
    const onlySrv = enabledServers[0];
    return onlySrv.last_health_status === 'offline' || installedOnIds.has(onlySrv.id);
  })();

  async function handleImport() {
    if (!onnxFile || !configFile || !name.trim() || noTargets) {
      return;
    }

    dispatch({ type: 'setLoading', value: true });
    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('onnx', onnxFile);
      formData.append('config', configFile);
      if (isMultiServer) {
        formData.append('serverIds', JSON.stringify(effectiveSelectedServerIds));
      }
      const result = await modelClient.importPiper(formData);
      // The actual upload runs as a background job per target server (visible in
      // the notification bell). result.jobIds.length tells the user how many uploads
      // were kicked off and lets them track them there instead of guessing whether
      // the toast meant "queued" or "done".
      toast.success(t('model.importPiperSuccess', { id: result.id, count: result.jobIds.length }));
      dispatch({ type: 'reset' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('voice.importFailed'));
      dispatch({ type: 'setLoading', value: false });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dispatch({ type: 'reset' });
        } else {
          dispatch({ type: 'setOpen', value: true });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-3.5" /> {t('common.import')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('model.importPiperTitle')}</DialogTitle>
          <DialogDescription>{t('model.importPiperDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="piper-name" className="text-sm font-medium">
              {t('model.modelName')}
            </label>
            <Input id="piper-name" placeholder={t('model.modelNamePlaceholder')} value={name} onChange={(e) => dispatch({ type: 'setName', value: e.target.value })} />
            {name.trim() && (
              <p className="text-xs text-muted-foreground">
                {t('model.modelId', {
                  id:
                    slug ??
                    `piper-??-${name
                      .trim()
                      .toLowerCase()
                      .replace(/\s+/g, '_')
                      .replace(/[^a-z0-9_]/g, '')}-medium`,
                })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('model.onnxFile')}</p>
            <FileDrop label={t('model.dropOnnx')} accept=".onnx" file={onnxFile} onFile={(f) => dispatch({ type: 'setOnnxFile', file: f })} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('model.configFile')}</p>
            <FileDrop label={t('model.dropConfig')} accept=".json" file={configFile} onFile={handleConfigFile} />
            {configInfo && (
              <div className="flex gap-2">
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs">espeak: {configInfo.voice}</span>
                {configInfo.speakers > 1 && <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{t('model.speakers', { count: configInfo.speakers })}</span>}
              </div>
            )}
          </div>

          {isMultiServer && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('model.installOn')}</p>
              <ul className="space-y-1">
                {enabledServers.map((server) => {
                  const status = (server.last_health_status || 'unknown') as 'online' | 'offline' | 'unknown';
                  const alreadyInstalled = installedOnIds.has(server.id);
                  const offline = status === 'offline';
                  const disabled = alreadyInstalled || offline;
                  const checked = effectiveSelectedServerIds.includes(server.id);
                  return (
                    <li key={server.id}>
                      <label className={cn('flex cursor-pointer items-center gap-2 rounded-md border border-border-subtle bg-card/40 px-2 py-1.5 text-xs', disabled && 'cursor-not-allowed opacity-60')}>
                        <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={() => toggleServer(server.id)} className="size-3.5" />
                        <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])} aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium">{server.name}</span>
                        {alreadyInstalled && <span className="text-muted-foreground">{t('model.alreadyInstalled')}</span>}
                        {offline && !alreadyInstalled && <span className="text-muted-foreground">{t('inferenceServers.statusOffline')}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <Button onClick={handleImport} disabled={!onnxFile || !configFile || !name.trim() || loading || noTargets} className="w-full">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {t('voice.importing')}
            </>
          ) : (
            <>
              <Plus className="size-4" /> {t('common.import')}
            </>
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
