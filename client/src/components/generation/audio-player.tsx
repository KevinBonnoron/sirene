import { Download, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { downloadUrl } from '@/lib/download';
import { formatTime } from '@/lib/format';

export function AudioPlayer({ src, filename }: { src: string; filename?: string }) {
  const { audioRef, isPlaying, currentTime, duration, toggle, seek } = useAudioPlayer();

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      {/* biome-ignore lint/a11y/useMediaCaption: TTS audio does not need captions */}
      <audio ref={audioRef} src={src} preload="metadata" />
      <Button variant="ghost" size="icon" onClick={toggle}>
        {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <span className="w-10 text-xs text-muted-foreground tabular-nums">{formatTime(currentTime)}</span>
      <Slider className="flex-1" min={0} max={duration || 1} step={0.1} value={[currentTime]} onValueChange={([v]) => seek(v)} />
      <span className="w-10 text-xs text-muted-foreground tabular-nums">{formatTime(duration)}</span>
      <Button variant="ghost" size="icon" onClick={() => downloadUrl(src, filename || 'audio.wav')}>
        <Download className="size-4" />
      </Button>
    </div>
  );
}
