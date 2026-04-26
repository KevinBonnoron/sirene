import type { Generation, Session, Voice } from '@sirene/shared';
import { Link } from '@tanstack/react-router';
import { AudioLines, Globe, Loader2, Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAudioPlayback } from '@/hooks/use-audio-playback';
import { pb } from '@/lib/pocketbase';

interface Props {
  sessionId: string;
}

interface Bundle {
  session: Session;
  generations: Generation[];
  voices: Voice[];
}

/**
 * Read-only page for a session shared via `/share/<id>`. The PB rules let any client read sessions
 * and generations where `public = true`, so we hit PB directly — no dedicated server endpoint.
 */
export function PublicSessionPage({ sessionId }: Props) {
  const { t } = useTranslation();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setError(null);

    (async () => {
      try {
        const session = await pb.collection<Session>('sessions').getOne(sessionId);
        const ids = Array.isArray(session.generations) ? session.generations : [];
        // Fetch generations one-by-one rather than via filter — `getFullList` with `id ?= "..." || ...`
        // is fragile across PB filter dialects. Single getOnes are simple, parallelisable, and let
        // us silently skip orphans.
        const gens = await Promise.all(
          ids.map((id) =>
            pb
              .collection<Generation>('generations')
              .getOne(id)
              .catch(() => null),
          ),
        );
        const generations = gens.filter((g): g is Generation => Boolean(g));
        const voiceIds = [...new Set(generations.map((g) => g.voice))];
        const voices = await Promise.all(
          voiceIds.map((id) =>
            pb
              .collection<Voice>('voices')
              .getOne(id)
              .catch(() => null),
          ),
        );
        if (cancelled) {
          return;
        }
        setBundle({
          session,
          generations,
          voices: voices.filter((v): v is Voice => Boolean(v)),
        });
      } catch {
        if (!cancelled) {
          setError(t('studio.publicSessionNotFound'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, t]);

  if (error) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-card">
          <AudioLines className="size-7 text-dim" />
        </div>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button asChild variant="outline">
          <Link to="/">{t('studio.openSirene')}</Link>
        </Button>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-5 animate-spin text-dim" />
      </div>
    );
  }

  const { session, generations, voices } = bundle;
  const orderedIds = Array.isArray(session.generations) ? session.generations : [];
  const ordered = orderedIds.map((id) => generations.find((g) => g.id === id)).filter((g): g is Generation => Boolean(g));
  const displayName = session.name?.trim().length ? session.name : t('studio.untitledSession');

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-border-subtle bg-background/85 px-4 backdrop-blur-sm">
        <h1 className="text-sm font-bold tracking-tight">Sirene</h1>
        <span className="text-xs text-dim">·</span>
        <span className="flex items-center gap-1.5 text-xs text-accent-amber">
          <Globe className="size-3.5" />
          {t('studio.publicSessionTitle')}
        </span>
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <Link to="/">{t('studio.openSirene')}</Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6 md:py-10">
        <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">{displayName}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('studio.publicSessionHint')}</p>

        <ol className="mt-8 space-y-4">
          {ordered.map((gen, i) => (
            <li key={gen.id}>
              <PublicTake index={i + 1} generation={gen} voice={voices.find((v) => v.id === gen.voice)} />
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}

interface PublicTakeProps {
  index: number;
  generation: Generation;
  voice: Voice | undefined;
}

function PublicTake({ index, generation, voice }: PublicTakeProps) {
  const { t } = useTranslation();
  const audioUrl = generation.audio ? pb.files.getURL(generation, generation.audio) : undefined;
  const { isPlaying, toggle } = useAudioPlayback(audioUrl);
  const voiceName = voice?.name ?? '—';
  const avatarUrl = voice?.avatar ? pb.files.getURL(voice, voice.avatar) : undefined;
  const duration = generation.duration ?? 0;

  return (
    <article className="rounded-lg border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <span className="font-mono text-[10.5px] text-dim tabular-nums">#{String(index).padStart(2, '0')}</span>
        <Avatar className="size-5">
          <AvatarImage src={avatarUrl} alt={voiceName} />
          <AvatarFallback className="text-[9px]">{voiceName.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="text-xs font-medium">{voiceName}</span>
        {duration > 0 && <span className="ml-auto font-mono text-[10.5px] text-dim tabular-nums">{formatTime(duration)}</span>}
      </header>

      <div className="px-5 py-4 font-serif text-[19px] leading-[1.75]">{generation.text}</div>

      <div className="flex items-center gap-3 border-t border-border-subtle px-4 py-2.5">
        <Button variant="ghost" size="icon" disabled={!audioUrl} onClick={toggle} className="size-8 rounded-full bg-bg-elevated hover:bg-card-elevated">
          {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-[1px]" />}
        </Button>
        <span className="text-xs text-muted-foreground">{isPlaying ? t('studio.playing') : audioUrl ? t('studio.tapToPlay') : t('studio.noAudio')}</span>
      </div>
    </article>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '0:00';
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
