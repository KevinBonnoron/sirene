import { Archive, FileUp, Loader2, Upload, X } from 'lucide-react';
import { type DragEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { voiceClient } from '@/clients/voice.client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatFileSize } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ImportVoiceDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ImportVoiceDialog({ open: controlledOpen, onOpenChange: controlledOnOpenChange }: ImportVoiceDialogProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File | null) {
    if (f && !f.name.endsWith('.zip')) {
      toast.error(t('voice.importSelectZip'));
      return;
    }
    setFile(f);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      handleFile(dropped);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  async function handleImport() {
    if (!file) {
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const voice = await voiceClient.importZip(formData);
      toast.success(t('voice.importSuccess', { name: voice.name }));
      setOpen(false);
      setFile(null);
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
          setFile(null);
          setDragging(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="cursor-pointer text-muted-foreground/50 hover:text-muted-foreground">
          <Upload className="size-4" /> {t('common.import')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('voice.importTitle')}</DialogTitle>
          <DialogDescription>{t('voice.importDescription')}</DialogDescription>
        </DialogHeader>

        <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />

        {file ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Archive className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            </div>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => setFile(null)}>
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragging(false)}
            className={cn('flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/50', dragging && 'border-primary bg-primary/5')}
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FileUp className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{t('voice.dropZipHere')}</p>
              <p className="text-xs text-muted-foreground">{t('voice.orClickBrowse')}</p>
            </div>
          </button>
        )}

        <div className="mt-auto grid grid-cols-1 gap-2 sm:flex sm:justify-end">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleImport} disabled={!file || loading}>
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> {t('voice.importing')}
              </>
            ) : (
              <>
                <Upload className="size-4" /> {t('common.import')}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
