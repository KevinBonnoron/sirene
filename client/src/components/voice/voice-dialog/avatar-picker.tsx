import { Pencil, X } from 'lucide-react';
import { useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface Props {
  src?: string;
  name: string;
  onFile: (file: File) => void;
  onClear: () => void;
}

export function AvatarPicker({ src, name, onFile, onClear }: Props) {
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
