import { useCallback, useEffect, useRef, useState } from 'react';

type AudioWithHandlers = HTMLAudioElement & {
  _onPlay?: () => void;
  _onPause?: () => void;
  _onEnded?: () => void;
  _onTimeUpdate?: () => void;
  _onError?: () => void;
};

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

function detachAudio(audio: AudioWithHandlers) {
  audio.pause();
  release(audio);
  if (audio._onPlay) {
    audio.removeEventListener('play', audio._onPlay);
  }
  if (audio._onPause) {
    audio.removeEventListener('pause', audio._onPause);
  }
  if (audio._onEnded) {
    audio.removeEventListener('ended', audio._onEnded);
  }
  if (audio._onTimeUpdate) {
    audio.removeEventListener('timeupdate', audio._onTimeUpdate);
  }
  if (audio._onError) {
    audio.removeEventListener('error', audio._onError);
  }
}

export interface UseAudioPlaybackResult {
  isPlaying: boolean;
  progress: number; // 0..1
  toggle: () => void;
  stop: () => void;
}

// Audio elements are allocated lazily on first toggle so a session with dozens of takes/bank
// entries doesn't create + preload one media element per row at mount time.
export function useAudioPlayback(url: string | null | undefined): UseAudioPlaybackResult {
  const audioRef = useRef<AudioWithHandlers | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on url; teardown reads audioRef
  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
    const previous = audioRef.current;
    if (previous) {
      detachAudio(previous);
      audioRef.current = null;
    }
    return () => {
      const audio = audioRef.current;
      if (audio) {
        detachAudio(audio);
        audioRef.current = null;
      }
    };
  }, [url]);

  const ensureAudio = useCallback(() => {
    if (!url) {
      return null;
    }
    if (audioRef.current) {
      return audioRef.current;
    }
    const audio = new Audio(url) as AudioWithHandlers;
    audio.preload = 'metadata';

    audio._onPlay = () => setIsPlaying(true);
    audio._onPause = () => setIsPlaying(false);
    audio._onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      release(audio);
    };
    audio._onTimeUpdate = () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    audio._onError = () => {
      setIsPlaying(false);
      setProgress(0);
      release(audio);
    };

    audio.addEventListener('play', audio._onPlay);
    audio.addEventListener('pause', audio._onPause);
    audio.addEventListener('ended', audio._onEnded);
    audio.addEventListener('timeupdate', audio._onTimeUpdate);
    audio.addEventListener('error', audio._onError);
    audioRef.current = audio;
    return audio;
  }, [url]);

  function toggle() {
    const audio = ensureAudio();
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
