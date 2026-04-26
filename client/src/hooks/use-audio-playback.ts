import { useEffect, useRef, useState } from 'react';

let currentAudio: HTMLAudioElement | null = null;

function claim(audio: HTMLAudioElement) {
  if (currentAudio && currentAudio !== audio) {
    currentAudio.pause();
  }
  currentAudio = audio;
}

function release(audio: HTMLAudioElement) {
  if (currentAudio === audio) {
    currentAudio = null;
  }
}

export interface UseAudioPlaybackResult {
  isPlaying: boolean;
  progress: number; // 0..1
  toggle: () => void;
  stop: () => void;
}

export function useAudioPlayback(url: string | null | undefined): UseAudioPlaybackResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);

    if (!url) {
      const previous = audioRef.current;
      if (previous) {
        previous.pause();
        release(previous);
      }
      audioRef.current = null;
      return;
    }
    const audio = new Audio(url);
    audio.preload = 'metadata';

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      release(audio);
    };
    const onTimeUpdate = () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    const onError = () => {
      setIsPlaying(false);
      setProgress(0);
      release(audio);
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onError);
    audioRef.current = audio;

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
      audio.pause();
      release(audio);
      audioRef.current = null;
    };
  }, [url]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      claim(audio);
      audio.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    setProgress(0);
    release(audio);
  }

  return { isPlaying, progress, toggle, stop };
}
