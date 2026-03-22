import { FileUp, X } from 'lucide-react';
import { type DragEvent, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/format';

interface Props {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
}

export function FileDrop({ label, accept, file, onFile }: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useReducer((_: boolean, v: boolean) => v, false);
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
