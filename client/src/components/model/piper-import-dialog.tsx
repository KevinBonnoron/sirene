import { FileUp, Loader2, Plus, X } from 'lucide-react';
import { type DragEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatFileSize } from '@/lib/format';
import { cn } from '@/lib/utils';

interface FileDropProps {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
}

function FileDrop({ label, accept, file, onFile }: FileDropProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      onFile(dropped);
    }
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => onFile(null)}>
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        className={cn('flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors hover:border-primary/50 hover:bg-accent/50', dragging && 'border-primary bg-primary/5')}
      >
        <FileUp className="size-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{t('voice.orClickBrowse')}</p>
        </div>
      </button>
    </>
  );
}

export function PiperImportDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [onnxFile, setOnnxFile] = useState<File | null>(null);
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [configInfo, setConfigInfo] = useState<{ voice: string; speakers: number; sampleRate: number } | null>(null);

  function handleConfigFile(f: File | null) {
    setConfigFile(f);
    setConfigInfo(null);

    if (f) {
      f.text().then((text) => {
        try {
          const data = JSON.parse(text);
          const voice = data?.espeak?.voice ?? 'unknown';
          const speakers = data?.num_speakers ?? 1;
          const sampleRate = data?.audio?.sample_rate ?? 22050;
          setConfigInfo({ voice, speakers, sampleRate });
        } catch {
          // invalid JSON — will be caught on submit
        }
      });
    }
  }

  function reset() {
    setName('');
    setOnnxFile(null);
    setConfigFile(null);
    setConfigInfo(null);
  }

  async function handleImport() {
    if (!onnxFile || !configFile || !name.trim()) {
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('onnx', onnxFile);
      formData.append('config', configFile);
      const result = await modelClient.importPiper(formData);
      toast.success(t('model.importPiperSuccess', { id: result.id }));
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('voice.importFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          reset();
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
            <Input id="piper-name" placeholder={t('model.modelNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
            {name.trim() && (
              <p className="text-xs text-muted-foreground">
                {t('model.modelId', {
                  id: (() => {
                    const speaker = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
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
            <FileDrop label={t('model.dropOnnx')} accept=".onnx" file={onnxFile} onFile={setOnnxFile} />
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
