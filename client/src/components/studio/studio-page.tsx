import { getVoiceCapabilities } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { Editor, JSONContent } from '@tiptap/core';
import { AudioLines, Loader2, Plus, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { generationCollection, sessionCollection, voiceCollection } from '@/collections';
import { Button } from '@/components/ui/button';
import { useGenerate } from '@/hooks/use-generate';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useIsDesktop, useIsMobile } from '@/hooks/use-mobile';
import { useModels } from '@/hooks/use-models';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { exportSessionAsZip } from '@/utils/export-session';
import { contentToSSML } from '@/utils/ssml';
import { DeleteSessionAlert } from './delete-session-alert';
import { generationToTake } from './generation-to-take';
import { SessionTitle } from './session-title';
import { ShareSessionDialog } from './share-session-dialog';
import { StudioTopbar } from './studio-topbar';
import { Take, type TakeData, type TakeTuning } from './take';
import { BANK_DRAG_MIME, type BankEntry, TakeBank } from './take-bank';

interface DraftState {
  voiceId: string;
  content: JSONContent;
  tuning: TakeTuning;
}

const DEFAULT_TUNING: TakeTuning = { pitchShift: 0, speedMultiplier: 1, variationSeed: 0.5 };
const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
}

function makeDraftTake(orderIndex: number, version: number, draft: DraftState): TakeData {
  return {
    id: `draft-${orderIndex}-${version}`,
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
  const { user } = useAuth();

  const { data: voices, isLoading: voicesLoading } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));
  const { data: generations, isLoading: generationsLoading } = useLiveQuery((q) => q.from({ gens: generationCollection }).orderBy(({ gens }) => gens.created, 'desc'));
  const { data: sessions, isLoading: sessionsLoading } = useLiveQuery((q) => q.from({ s: sessionCollection }).orderBy(({ s }) => s.updated, 'desc'));
  const { generate } = useGenerate();
  const { catalog } = useModels();

  const navigate = useNavigate({ from: '/' });
  const search = useSearch({ from: '/_app/' });
  const activeSessionId = search.session ?? null;
  const setActiveSessionId = useCallback(
    (id: string | null) => {
      navigate({ search: (prev) => ({ ...prev, session: id ?? undefined }), replace: true });
    },
    [navigate],
  );

  const [sessionNameDraft, setSessionNameDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number>(0);
  const [busyTakeId, setBusyTakeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);

  const activeSession = useMemo(() => (activeSessionId ? sessions?.find((s) => s.id === activeSessionId) : undefined), [activeSessionId, sessions]);
  const activeSessionGenerationIds = useMemo(() => asStringArray(activeSession?.generations), [activeSession]);
  const sessionGenerations = useMemo(() => activeSessionGenerationIds.map((genId) => generations?.find((g) => g.id === genId)).filter((g): g is NonNullable<typeof g> => Boolean(g)), [activeSessionGenerationIds, generations]);

  const [currentSoloId, setCurrentSoloId] = useState<string | null>(null);
  const currentSoloGeneration = useMemo(() => (currentSoloId ? generations?.find((g) => g.id === currentSoloId) : undefined), [currentSoloId, generations]);

  const [draftVersion, setDraftVersion] = useState(0);

  const [wantsDraft, setWantsDraft] = useState(true);
  const [bankDragDepth, setBankDragDepth] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [bankOpen, setBankOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined' || window.innerWidth < 1280) {
      return false;
    }
    return localStorage.getItem('sirene-bank-open') !== '0';
  });
  const toggleBank = useCallback(() => {
    setBankOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined' && window.innerWidth >= 1280) {
        localStorage.setItem('sirene-bank-open', next ? '1' : '0');
      }
      return next;
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on session id only
  useEffect(() => {
    setEditingName(false);
  }, [activeSession?.id]);

  useEffect(() => {
    if (activeSession) {
      setSessionNameDraft(activeSession.name?.length ? activeSession.name : null);
    }
  }, [activeSession]);

  useEffect(() => {
    if (draft || !voices?.length) {
      return;
    }
    const lastTake = sessionGenerations[sessionGenerations.length - 1];
    const seedVoice = lastTake?.voice ?? voices[0].id;
    setDraft({ voiceId: seedVoice, content: EMPTY_DOC, tuning: { ...DEFAULT_TUNING } });
  }, [draft, voices, sessionGenerations]);

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
        await sessionCollection.update(activeSession.id, (draft) => {
          draft.name = sessionNameDraft ?? '';
        }).isPersisted.promise;
        setSavedAt(Date.now());
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('studio.failedToSaveSession'));
      } finally {
        setSaving(false);
      }
    }, 500);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [sessionNameDraft, activeSession, t]);

  const handleDraftContentChange = useCallback((editor: Editor) => {
    setDraft((d) => (d ? { ...d, content: editor.getJSON() } : d));
  }, []);

  const handleDraftVoiceChange = useCallback((voiceId: string) => {
    setDraft((d) => (d ? { ...d, voiceId } : d));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!draft || !draft.voiceId || busyTakeId) {
      return;
    }
    const ssml = contentToSSML(draft.content);
    if (!ssml.trim()) {
      return;
    }

    setBusyTakeId('draft');
    try {
      const { generationId } = await generate({
        voice: draft.voiceId,
        input: ssml,
        tuning: draft.tuning,
        ssmlJson: draft.content as unknown as Record<string, unknown>,
      });

      if (generationId) {
        if (activeSessionId) {
          const session = sessions?.find((s) => s.id === activeSessionId);
          if (session) {
            const nextGenerations = [...asStringArray(session.generations), generationId];
            await sessionCollection.update(activeSessionId, (s) => {
              s.generations = nextGenerations;
            }).isPersisted.promise;
          }
        } else if (currentSoloId && user) {
          const created = await pb.collection('sessions').create({
            name: '',
            user: user.id,
            generations: [currentSoloId, generationId],
          });
          setActiveSessionId(created.id);
        } else {
          setCurrentSoloId(generationId);
        }
      }

      setDraft((d) => (d ? { ...d, content: EMPTY_DOC } : d));
      setDraftVersion((v) => v + 1);
      setWantsDraft(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('generate.failed'));
    } finally {
      setBusyTakeId(null);
    }
  }, [draft, busyTakeId, generate, activeSessionId, sessions, currentSoloId, user, t, setActiveSessionId]);

  const handleRegenerate = useCallback(
    async (take: TakeData, text: string, tuning: TakeTuning) => {
      if (busyTakeId) {
        return;
      }
      setBusyTakeId(take.id);
      try {
        const { generationId } = await generate({
          voice: take.voiceId,
          input: text,
          tuning,
          ssmlJson: take.content as unknown as Record<string, unknown>,
        });
        if (!generationId) {
          return;
        }
        if (activeSessionId) {
          const session = sessions?.find((s) => s.id === activeSessionId);
          if (session) {
            const nextGenerations = asStringArray(session.generations).map((id) => (id === take.id ? generationId : id));
            await sessionCollection.update(activeSessionId, (s) => {
              s.generations = nextGenerations;
            }).isPersisted.promise;
          }
        } else if (currentSoloId === take.id) {
          setCurrentSoloId(generationId);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('generate.failed'));
      } finally {
        setBusyTakeId(null);
      }
    },
    [busyTakeId, generate, activeSessionId, sessions, currentSoloId, t],
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
      const nextGenerations = asStringArray(session.generations).filter((id) => id !== takeId);
      try {
        await sessionCollection.update(activeSessionId, (s) => {
          s.generations = nextGenerations;
        }).isPersisted.promise;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('studio.failedToDeleteTake'));
      }
    },
    [activeSessionId, sessions, t],
  );

  const handleDropFromBank = useCallback(
    async (generationId: string) => {
      if (activeSessionId) {
        const session = sessions?.find((s) => s.id === activeSessionId);
        if (!session) {
          return;
        }
        const ids = asStringArray(session.generations);
        if (ids.includes(generationId)) {
          return;
        }
        try {
          await sessionCollection.update(activeSessionId, (s) => {
            s.generations = [...ids, generationId];
          }).isPersisted.promise;
          setWantsDraft(false);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t('studio.failedToAddTake'));
        }
        return;
      }
      if (currentSoloId === generationId) {
        return;
      }
      if (currentSoloId && user) {
        try {
          const created = await pb.collection('sessions').create({
            name: '',
            user: user.id,
            generations: [currentSoloId, generationId],
          });
          setActiveSessionId(created.id);
          setWantsDraft(false);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t('studio.failedToCreateSession'));
        }
        return;
      }
      setCurrentSoloId(generationId);
      setWantsDraft(false);
    },
    [activeSessionId, sessions, currentSoloId, user, setActiveSessionId, t],
  );

  const isBankDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(BANK_DRAG_MIME);
  const handleDragEnter = (e: React.DragEvent) => {
    if (!isBankDrag(e)) {
      return;
    }
    e.preventDefault();
    setBankDragDepth((d) => d + 1);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!isBankDrag(e)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!isBankDrag(e)) {
      return;
    }
    setBankDragDepth((d) => Math.max(0, d - 1));
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!isBankDrag(e)) {
      return;
    }
    e.preventDefault();
    setBankDragDepth(0);
    const id = e.dataTransfer.getData(BANK_DRAG_MIME);
    if (id) {
      handleDropFromBank(id);
    }
  };

  useKeyboardShortcut(() => handleAddTake(), { key: 'n' });

  async function handleAddTake() {
    setWantsDraft(true);
    if (activeSession) {
      return;
    }
    if (!currentSoloGeneration) {
      return;
    }
    if (!user) {
      toast.error(t('studio.notAuthenticated'));
      return;
    }
    try {
      const created = await pb.collection('sessions').create({
        name: '',
        user: user.id,
        generations: [currentSoloGeneration.id],
      });
      setActiveSessionId(created.id);
      setCurrentSoloId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('studio.failedToCreateSession'));
    }
  }

  const inSession = activeSessionId !== null;
  const showSessionTitle = inSession;
  const collectionsLoading = voicesLoading || sessionsLoading || generationsLoading;
  const sessionLoading = inSession && (collectionsLoading || (activeSession && sessionGenerations.length < activeSessionGenerationIds.length));
  const sessionNotFound = inSession && !collectionsLoading && !activeSession;

  if (!voices || voicesLoading) {
    return (
      <div className="flex h-svh overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <StudioTopbar sessionName={null} saved takeCount={0} inSession={inSession} bankOpen={bankOpen} onToggleBank={toggleBank} />
          <main className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-dim" />
          </main>
        </div>
      </div>
    );
  }

  if (voices.length === 0 && !inSession) {
    return (
      <div className="flex h-svh overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <StudioTopbar sessionName={null} saved takeCount={0} inSession={false} bankOpen={bankOpen} onToggleBank={toggleBank} />
          <main className="custom-scrollbar flex-1 overflow-y-auto">
            <div className={`mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6 md:py-10 ${isMobile ? 'pb-24' : ''}`}>
              <NoVoicesState />
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!draft && voices.length > 0) {
    return (
      <div className="flex h-svh overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <StudioTopbar sessionName={null} saved takeCount={0} inSession={inSession} bankOpen={bankOpen} onToggleBank={toggleBank} />
          <main className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-dim" />
          </main>
        </div>
      </div>
    );
  }

  const mainGenerations = activeSession ? sessionGenerations : currentSoloGeneration ? [currentSoloGeneration] : [];
  const mainTakes: TakeData[] = mainGenerations.map((gen, i) => generationToTake(gen, i + 1));
  const draftTake = draft ? makeDraftTake(mainTakes.length + 1, draftVersion, draft) : null;
  const showDraft = !sessionNotFound && draftTake !== null && (mainTakes.length === 0 || wantsDraft);
  const displayTakes = showDraft && draftTake ? [...mainTakes, draftTake] : mainTakes;
  const generatedCount = mainTakes.length;

  const mainGenerationIds = new Set(mainGenerations.map((g) => g.id));
  const bankEntries: BankEntry[] = (generations ?? [])
    .filter((g) => g.audio && !mainGenerationIds.has(g.id))
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
        <StudioTopbar
          sessionName={showSessionTitle ? sessionNameDraft : null}
          saving={saving}
          saved={savedFeedback || !saving}
          takeCount={generatedCount}
          inSession={showSessionTitle}
          isPublic={Boolean(activeSession?.public)}
          onShare={activeSession ? () => setShareOpen(true) : undefined}
          onExport={
            activeSession
              ? () => {
                  exportSessionAsZip({ session: activeSession, generations: sessionGenerations, voices }).catch((err) => toast.error(err instanceof Error ? err.message : t('studio.exportFailed')));
                }
              : undefined
          }
          onDelete={activeSession ? () => setPendingDelete({ id: activeSession.id, name: activeSession.name?.trim().length ? activeSession.name : t('studio.untitledSession') }) : undefined}
          onRename={activeSession ? () => setEditingName(true) : undefined}
          bankOpen={bankOpen}
          onToggleBank={toggleBank}
        />

        <main className="custom-scrollbar flex-1 overflow-y-auto" onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div className={cn(`mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6 md:py-10 ${isMobile ? 'pb-24' : ''}`, bankDragDepth > 0 && 'rounded-lg outline-2 outline-dashed outline-accent-amber/60 -outline-offset-8 bg-accent-amber/5')}>
            {sessionLoading ? (
              <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="size-5 animate-spin text-dim" />
              </div>
            ) : sessionNotFound ? (
              <SessionNotFoundState />
            ) : (
              <>
                {showSessionTitle && <SessionTitle name={sessionNameDraft} onChange={setSessionNameDraft} editing={editingName} onEditingChange={setEditingName} />}

                {!activeSession && mainTakes.length === 0 && voices.length > 0 && <EmptyState />}
                {voices.length === 0 && !activeSession && <NoVoicesState />}

                <ol className="space-y-4">
                  {displayTakes.map((take) => {
                    const isCurrentDraft = take.state === 'draft';
                    const original = !isCurrentDraft ? generations?.find((g) => g.id === take.id) : undefined;
                    const voice = voices.find((v) => v.id === take.voiceId);
                    const modelEntry = voice ? catalog.find((m) => m.id === voice.model) : undefined;
                    const capabilities = getVoiceCapabilities(modelEntry?.backend);
                    return (
                      <li key={isCurrentDraft ? `draft-${draftVersion}` : `slot-${take.orderIndex}`}>
                        <Take
                          take={take}
                          isGenerating={busyTakeId === (isCurrentDraft ? 'draft' : take.id)}
                          disabled={busyTakeId !== null && busyTakeId !== (isCurrentDraft ? 'draft' : take.id)}
                          capabilities={capabilities}
                          onContentChange={isCurrentDraft ? handleDraftContentChange : undefined}
                          onVoiceChange={isCurrentDraft ? handleDraftVoiceChange : undefined}
                          onGenerate={isCurrentDraft ? handleGenerate : undefined}
                          onRegenerate={!isCurrentDraft && original ? (tuning) => handleRegenerate(take, original.text, tuning) : undefined}
                          onDelete={!isCurrentDraft && activeSession ? () => handleDeleteTake(take.id) : undefined}
                        />
                      </li>
                    );
                  })}
                </ol>
              </>
            )}

            {!sessionLoading && !sessionNotFound && generatedCount >= 1 && !showDraft && (
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

      {isDesktop ? (
        <div className={cn('shrink-0 overflow-hidden transition-[width] duration-200 ease-out', bankOpen ? 'w-[320px]' : 'w-0')} aria-hidden={!bankOpen}>
          <TakeBank entries={bankEntries} onAdd={handleDropFromBank} />
        </div>
      ) : (
        <>
          {bankOpen && <button type="button" aria-label="Close" onClick={toggleBank} className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm" />}
          <div className={cn('fixed inset-y-0 right-0 z-50 transition-transform duration-200 ease-out', bankOpen ? 'translate-x-0' : 'translate-x-full')} aria-hidden={!bankOpen}>
            <TakeBank
              entries={bankEntries}
              onAdd={(id) => {
                handleDropFromBank(id);
                setBankOpen(false);
              }}
            />
          </div>
        </>
      )}

      <ShareSessionDialog open={shareOpen} onOpenChange={setShareOpen} session={activeSession ?? null} />
      <DeleteSessionAlert pendingId={pendingDelete?.id ?? null} pendingName={pendingDelete?.name ?? ''} onClose={() => setPendingDelete(null)} />
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
      <Button asChild className="mt-2 gap-1.5 bg-accent-amber text-primary-foreground hover:bg-accent-amber/90">
        <Link to="/voices">
          <Plus className="size-4" />
          {t('studio.noVoicesCta')}
        </Link>
      </Button>
    </div>
  );
}

function SessionNotFoundState() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-card">
        <AudioLines className="size-6 text-dim" />
      </div>
      <h2 className="font-serif text-xl tracking-tight">{t('studio.sessionNotFoundTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('studio.sessionNotFoundHint')}</p>
      <Button asChild variant="outline" className="mt-2">
        <Link to="/" search={{ session: undefined }}>
          {t('studio.backToStudio')}
        </Link>
      </Button>
    </div>
  );
}
