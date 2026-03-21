import { Download, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/download';
import { formatTime } from '@/lib/format';

function resolveColor(el: Element, varName: string): string {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim();
  if (!raw) {
    return '#888';
  }
  const tmp = document.createElement('div');
  tmp.style.color = raw;
  tmp.style.display = 'none';
  el.appendChild(tmp);
  const color = getComputedStyle(tmp).color;
  el.removeChild(tmp);
  return color || '#888';
}

const audioBlobCache = new Map<string, Promise<Blob>>();

function fetchAudioBlob(url: string): Promise<Blob> {
  const cached = audioBlobCache.get(url);
  if (cached) {
    return cached;
  }
  const promise = fetch(url).then((res) => res.blob());
  audioBlobCache.set(url, promise);
  return promise;
}

type WaveformState = { isPlaying: boolean; currentTime: number; duration: number };
type WaveformAction = { type: 'play' } | { type: 'pause' } | { type: 'timeupdate'; time: number } | { type: 'ready'; duration: number };

function waveformReducer(state: WaveformState, action: WaveformAction): WaveformState {
  switch (action.type) {
    case 'play':
      return { ...state, isPlaying: true };
    case 'pause':
      return { ...state, isPlaying: false };
    case 'timeupdate':
      return { ...state, currentTime: action.time };
    case 'ready':
      return { ...state, duration: action.duration };
  }
}

export function Waveform({ src, height = 32, autoPlay = false }: { src: string | Blob; height?: number; autoPlay?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [{ isPlaying, currentTime, duration }, dispatch] = useReducer(waveformReducer, {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  });

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const waveColor = resolveColor(containerRef.current, '--waveform');
    const progressColor = resolveColor(containerRef.current, '--waveform-progress');

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      barWidth: 3,
      barGap: 2,
      barRadius: 2,
      cursorWidth: 0,
      waveColor,
      progressColor,
      normalize: true,
      interact: true,
    });

    let destroyed = false;

    ws.on('play', () => {
      if (!destroyed) {
        dispatch({ type: 'play' });
      }
    });
    ws.on('pause', () => {
      if (!destroyed) {
        dispatch({ type: 'pause' });
      }
    });
    ws.on('finish', () => {
      if (!destroyed) {
        dispatch({ type: 'pause' });
      }
    });
    ws.on('timeupdate', (time) => {
      if (!destroyed) {
        dispatch({ type: 'timeupdate', time });
      }
    });
    ws.on('ready', () => {
      if (!destroyed) {
        dispatch({ type: 'ready', duration: ws.getDuration() });
        if (autoPlay) {
          ws.play();
        }
      }
    });
    ws.on('error', () => {
      /* suppress fetch abort errors */
    });

    if (src instanceof Blob) {
      ws.loadBlob(src).catch(() => {});
    } else {
      fetchAudioBlob(src)
        .then((blob) => {
          if (!destroyed) {
            ws.loadBlob(blob).catch(() => {});
          }
        })
        .catch(() => {});
    }

    wsRef.current = ws;

    return () => {
      destroyed = true;
      ws.destroy();
      wsRef.current = null;
    };
  }, [src, height, autoPlay]);

  const toggle = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={toggle} type="button">
        {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <div ref={containerRef} className="min-w-0 flex-1 cursor-pointer" />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTime(currentTime)}/{formatTime(duration)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        type="button"
        onClick={async () => {
          const blob = src instanceof Blob ? src : await fetch(src).then((res) => res.blob());
          downloadBlob(blob, 'audio.wav');
        }}
      >
        <Download className="size-3.5" />
      </Button>
    </div>
  );
}
