import { Loader2, Plus } from 'lucide-react';
import { useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FileDrop } from '../atoms/file-drop';

type PiperState = {
  open: boolean;
  loading: boolean;
  name: string;
  onnxFile: File | null;
  configFile: File | null;
  configInfo: { voice: string; speakers: number; sampleRate: number } | null;
};

type PiperAction = { type: 'setOpen'; value: boolean } | { type: 'setLoading'; value: boolean } | { type: 'setName'; value: string } | { type: 'setOnnxFile'; file: File | null } | { type: 'setConfigFile'; file: File | null; info: PiperState['configInfo'] } | { type: 'reset' };

const piperInitial: PiperState = { open: false, loading: false, name: '', onnxFile: null, configFile: null, configInfo: null };

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
    case 'reset':
      return { ...piperInitial, open: false };
  }
}

export function PiperImportDialog() {
  const { t } = useTranslation();
  const [{ open, loading, name, onnxFile, configFile, configInfo }, dispatch] = useReducer(piperReducer, piperInitial);

  function handleConfigFile(f: File | null) {
    if (!f) {
      dispatch({ type: 'setConfigFile', file: null, info: null });
      return;
    }
    f.text().then((text) => {
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

  async function handleImport() {
    if (!onnxFile || !configFile || !name.trim()) {
      return;
    }

    dispatch({ type: 'setLoading', value: true });
    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('onnx', onnxFile);
      formData.append('config', configFile);
      const result = await modelClient.importPiper(formData);
      toast.success(t('model.importPiperSuccess', { id: result.id }));
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
                  id: (() => {
                    const speaker = name
                      .trim()
                      .toLowerCase()
                      .replace(/\s+/g, '_')
                      .replace(/[^a-z0-9_]/g, '');
                    if (!configInfo) {
                      return `piper-??-${speaker}-medium`;
                    }
                    const [lang = '', region] = configInfo.voice.split('-');
                    const locale = region ? `${lang.toLowerCase()}_${region.toUpperCase()}` : lang.toLowerCase();
                    const quality = configInfo.sampleRate <= 16000 ? 'low' : 'medium';
                    return `piper-${locale}-${speaker}-${quality}`;
                  })(),
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
        </div>

        <Button onClick={handleImport} disabled={!onnxFile || !configFile || !name.trim() || loading} className="w-full">
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
