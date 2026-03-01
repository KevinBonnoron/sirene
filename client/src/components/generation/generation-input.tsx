import type { GenerateRequest } from '@sirene/shared';
import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  voiceId: string;
  generate: (request: GenerateRequest) => Promise<Blob>;
  isGenerating: boolean;
}

export function GenerationInput({ voiceId, generate, isGenerating }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState(1);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!voiceId || !text.trim()) {
      return;
    }
    try {
      await generate({ voice: voiceId, input: text, speed });
      setText('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('generate.failed'));
    }
  }

  const canSubmit = !isGenerating && !!voiceId && !!text.trim();

  return (
    <form onSubmit={handleSubmit}>
      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          <div className="relative">
            <Textarea
              placeholder={t('generate.placeholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSubmit) {
                    handleSubmit(e);
                  }
                }
              }}
              disabled={isGenerating}
              rows={2}
              className="min-h-0 resize-none rounded-b-none border-0 px-4 py-3 pr-12 text-sm shadow-none focus-visible:ring-0"
            />
            <Button type="submit" size="icon" disabled={!canSubmit} className="absolute right-2 bottom-2 size-7 shrink-0 rounded-full">
              {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            </Button>
          </div>

          <div className="border-t px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Select value={`${speed}`} onValueChange={(v) => setSpeed(Number(v))}>
                  <SelectTrigger className="h-7 w-auto gap-1.5 rounded-full border px-2.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                      <SelectItem key={s} value={`${s}`}>
                        {s.toFixed(s % 1 ? 2 : 1)}x
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <span className="text-muted-foreground text-[10px]">{t('generate.chars', { count: text.length })}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
