import { useLiveQuery } from '@tanstack/react-db';
import { Link } from '@tanstack/react-router';
import type { Editor, JSONContent } from '@tiptap/core';
import { AudioLines, Plus, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { generationCollection, sessionCollection, voiceCollection } from '@/collections';
import { Button } from '@/components/ui/button';
import { useGenerate } from '@/hooks/use-generate';
import { useIsDesktop, useIsMobile } from '@/hooks/use-mobile';
import { pb } from '@/lib/pocketbase';
import { contentToSSML } from '@/utils/ssml';
import { generationToTake } from './generation-to-take';
import { StudioTopbar } from './studio-topbar';
import { Take, type TakeData, type TakeTuning } from './take';
import { type BankEntry, TakeBank } from './take-bank';

interface DraftState {
  voiceId: string;
  content: JSONContent;
  tuning: TakeTuning;
}

const DEFAULT_TUNING: TakeTuning = { pitchShift: 0, speedMultiplier: 1, variationSeed: 0.5 };
const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

function makeDraftTake(orderIndex: number, draft: DraftState): TakeData {
  return {
    id: `draft-${orderIndex}`,
    orderIndex,
    state: 'draft',
    voiceId: draft.voiceId,
    content: draft.content,
    tuning: draft.tuning,
  };
}

export function StudioPage() {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();

  const { data: voices } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));
  const { data: generations } = useLiveQuery((q) => q.from({ gens: generationCollection }).orderBy(({ gens }) => gens.created, 'desc'));
  const { data: sessions } = useLiveQuery((q) => q.from({ s: sessionCollection }).orderBy(({ s }) => s.updated, 'desc'));
  const { generate, isGenerating } = useGenerate();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number>(0);

  // Draft state: seeded from the last session take's voice when available.
  const [draft, setDraft] = useState<DraftState | null>(null);

  const activeSession = useMemo(() => (activeSessionId ? sessions?.find((s) => s.id === activeSessionId) : undefined), [activeSessionId, sessions]);

  const sessionGenerations = useMemo(() => (activeSession?.generations ?? []).map((genId) => generations?.find((g) => g.id === genId)).filter((g): g is NonNullable<typeof g> => Boolean(g)), [activeSession, generations]);

  // Sync session name with the loaded session
  useEffect(() => {
    if (activeSession) {
      setSessionNameDraft(activeSession.name?.length ? activeSession.name : null);
    }
  }, [activeSession]);

  // Seed the draft voice from the latest session take, or the first voice overall
  useEffect(() => {
    if (draft || !voices?.length) {
      return;
    }
    const lastTake = sessionGenerations[sessionGenerations.length - 1];
    const seedVoice = lastTake?.voice ?? voices[0].id;
    setDraft({ voiceId: seedVoice, content: EMPTY_DOC, tuning: { ...DEFAULT_TUNING } });
  }, [draft, voices, sessionGenerations]);

  // Auto-save session name (500ms debounce)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSession) {
      return;
    }
    const current = activeSession.name?.length ? activeSession.name : null;
    if (sessionNameDraft === current) {
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        await pb.collection('sessions').update(activeSession.id, { name: sessionNameDraft ?? '' });
        setSavedAt(Date.now());
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save session');
      } finally {
        setSaving(false);
      }
    }, 500);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [sessionNameDraft, activeSession]);

  const handleDraftContentChange = useCallback((editor: Editor) => {
    setDraft((d) => (d ? { ...d, content: editor.getJSON() } : d));
  }, []);

  const handleDraftVoiceChange = useCallback((voiceId: string) => {
    setDraft((d) => (d ? { ...d, voiceId } : d));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!draft || !draft.voiceId) {
      return;
    }
    const ssml = contentToSSML(draft.content);
    if (!ssml.trim()) {
      return;
    }

    try {
      const { generationId } = await generate({
        voice: draft.voiceId,
        input: ssml,
        tuning: draft.tuning,
        ssmlJson: draft.content as unknown as Record<string, unknown>,
      });

      // Attach to active session
      if (activeSessionId && generationId) {
        const session = sessions?.find((s) => s.id === activeSessionId);
        if (session) {
          const nextGenerations = [...session.generations, generationId];
          await pb.collection('sessions').update(activeSessionId, { generations: nextGenerations });
        }
      }

      // Reset draft, keep voice + tuning for the next take
      setDraft((d) => (d ? { ...d, content: EMPTY_DOC } : d));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('generate.failed'));
    }
  }, [draft, generate, activeSessionId, sessions, t]);

  const handleRegenerate = useCallback(
    async (take: TakeData, text: string) => {
      try {
        const { generationId } = await generate({
          voice: take.voiceId,
          input: text,
          tuning: take.tuning,
          ssmlJson: take.content as unknown as Record<string, unknown>,
        });
        if (activeSessionId && generationId) {
          const session = sessions?.find((s) => s.id === activeSessionId);
          if (session) {
            const nextGenerations = session.generations.map((id) => (id === take.id ? generationId : id));
            await pb.collection('sessions').update(activeSessionId, { generations: nextGenerations });
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('generate.failed'));
      }
    },
    [generate, activeSessionId, sessions, t],
  );

  const handleDeleteTake = useCallback(
    async (takeId: string) => {
      if (!activeSessionId) {
        return;
      }
      const session = sessions?.find((s) => s.id === activeSessionId);
      if (!session) {
        return;
      }
      const nextGenerations = session.generations.filter((id) => id !== takeId);
      try {
        await pb.collection('sessions').update(activeSessionId, { generations: nextGenerations });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete take');
      }
    },
    [activeSessionId, sessions],
  );

  const handleTuningChange = useCallback(async (take: TakeData, tuning: TakeTuning) => {
    try {
      await pb.collection('generations').update(take.id, { tuning, state: 'tuned' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save tuning');
    }
  }, []);

  async function handleAddTake() {
    if (activeSession) {
      return;
    }
    const latest = generations?.find((g) => Boolean(g.audio));
    if (!latest) {
      toast.info(t('studio.draftHint'));
      return;
    }
    try {
      const created = await pb.collection('sessions').create({
        name: '',
        user: pb.authStore.record?.id,
        generations: [latest.id],
      });
      setActiveSessionId(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session');
    }
  }

  // --- Loading + gating states ----------------------------------------------
  if (!voices) {
    return (
      <div className="flex h-svh items-center justify-center text-muted-foreground text-sm">
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  if (voices.length === 0) {
    return (
      <div className="flex h-svh overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <StudioTopbar sessionName={null} onSessionNameChange={() => {}} saved takeCount={0} />
          <main className="custom-scrollbar flex-1 overflow-y-auto">
            <div className={`mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6 md:py-10 ${isMobile ? 'pb-24' : ''}`}>
              <NoVoicesState />
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="flex h-svh items-center justify-center text-muted-foreground text-sm">
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  // --- Derive takes from real data ------------------------------------------
  const sessionTakes: TakeData[] = sessionGenerations.map((gen, i) => generationToTake(gen, i + 1));
  const draftTake = makeDraftTake(sessionTakes.length + 1, draft);
  const displayTakes = [...sessionTakes, draftTake];
  const generatedCount = sessionTakes.length;
  const showSessionTitle = Boolean(activeSession);

  // Bank: recent non-draft generations (skip ones already shown in the session column)
  const sessionGenerationIds = new Set(activeSession?.generations ?? []);
  const bankEntries: BankEntry[] = (generations ?? [])
    .filter((g) => g.audio && !sessionGenerationIds.has(g.id))
    .slice(0, 30)
    .map((g) => {
      const voice = voices.find((v) => v.id === g.voice);
      return {
        id: g.id,
        voiceName: voice?.name ?? 'Inconnue',
        voiceAvatarUrl: voice?.avatar ? pb.files.getURL(voice, voice.avatar) : undefined,
        modelName: g.model,
        text: g.text,
        duration: g.duration ?? 0,
        createdAt: new Date(g.created),
        audioUrl: g.audio ? pb.files.getURL(g, g.audio) : undefined,
      };
    });

  const savedFeedback = savedAt > 0 && Date.now() - savedAt < 3000;

  return (
    <div className="flex h-svh overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <StudioTopbar sessionName={showSessionTitle ? sessionNameDraft : null} onSessionNameChange={setSessionNameDraft} saving={saving} saved={savedFeedback || !saving} takeCount={generatedCount} />

        <main className="custom-scrollbar flex-1 overflow-y-auto">
          <div className={`mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6 md:py-10 ${isMobile ? 'pb-24' : ''}`}>
            {showSessionTitle && <h1 className="mb-6 font-serif text-2xl tracking-tight sm:text-3xl">{sessionNameDraft ?? <span className="italic text-dim">{t('studio.untitledSession')}</span>}</h1>}

            {!activeSession && sessionTakes.length === 0 && <EmptyState />}

            <ol className="space-y-4">
              {displayTakes.map((take) => {
                const isCurrentDraft = take.state === 'draft';
                const original = !isCurrentDraft ? generations?.find((g) => g.id === take.id) : undefined;
                return (
                  <li key={take.id}>
                    <Take
                      take={take}
                      isGenerating={isCurrentDraft ? isGenerating : false}
                      onContentChange={isCurrentDraft ? handleDraftContentChange : undefined}
                      onVoiceChange={isCurrentDraft ? handleDraftVoiceChange : undefined}
                      onGenerate={isCurrentDraft ? handleGenerate : undefined}
                      onRegenerate={!isCurrentDraft && original ? () => handleRegenerate(take, original.text) : undefined}
                      onDelete={!isCurrentDraft ? () => handleDeleteTake(take.id) : undefined}
                      onTuningChange={!isCurrentDraft ? (tuning) => handleTuningChange(take, tuning) : undefined}
                    />
                  </li>
                );
              })}
            </ol>

            {generatedCount >= 1 && (
              <button type="button" onClick={handleAddTake} className="mt-4 flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-accent-amber/60 hover:bg-card/40 hover:text-foreground">
                <span className="flex min-w-0 items-center gap-2">
                  <Plus className="size-4 shrink-0" />
                  <span className="truncate">
                    {t('studio.addTake')}
                    <span className="hidden text-muted-foreground/70 sm:inline"> — {t('studio.addTakeHint')}</span>
                  </span>
                </span>
                <kbd className="hidden shrink-0 rounded-md border border-border bg-muted px-2 py-1 font-sans text-[11px] leading-none text-foreground shadow-sm sm:inline">⌘N</kbd>
              </button>
            )}
          </div>
        </main>
      </div>

      {isDesktop && <TakeBank entries={bankEntries} />}
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="mb-8 flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-card">
        <Sparkles className="size-6 text-accent-amber" />
      </div>
      <h2 className="font-serif text-2xl tracking-tight">{t('studio.emptyTitle')}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{t('studio.emptyHint')}</p>
    </div>
  );
}

function NoVoicesState() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-card">
        <AudioLines className="size-7 text-accent-amber" />
      </div>
      <h2 className="font-serif text-2xl tracking-tight">{t('studio.noVoicesTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('studio.noVoicesHint')}</p>
      <Button asChild className="mt-2 gap-1.5 bg-accent-amber text-bg-elevated hover:bg-accent-amber/90">
        <Link to="/voices">
          <Plus className="size-4" />
          {t('studio.noVoicesCta')}
        </Link>
      </Button>
    </div>
  );
}
