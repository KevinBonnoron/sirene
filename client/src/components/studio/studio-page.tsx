import { getVoiceCapabilities } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { Editor, JSONContent } from '@tiptap/core';
import { AudioLines, Plus, Sparkles } from 'lucide-react';
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

/**
 * PocketBase multi-select relations can come back as either a string[] or — in some edge cases
 * (single value, legacy data, race during realtime sync) — a bare string. Normalise everywhere
 * we touch `session.generations` so the UI never crashes on `.map is not a function`.
 */
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

  const { data: voices } = useLiveQuery((q) => q.from({ voices: voiceCollection }).orderBy(({ voices }) => voices.created, 'desc'));
  const { data: generations } = useLiveQuery((q) => q.from({ gens: generationCollection }).orderBy(({ gens }) => gens.created, 'desc'));
  const { data: sessions } = useLiveQuery((q) => q.from({ s: sessionCollection }).orderBy(({ s }) => s.updated, 'desc'));
  const { generate } = useGenerate();
  const { catalog } = useModels();

  // Active session id is URL-driven (`?session=<id>`) so the AppSidebar's recent-sessions list
  // can switch sessions just by linking. setActiveSessionId is a navigation helper that keeps
  // the rest of the page logic readable.
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
  // Which take is currently being generated / regenerated ('draft' for the composer, or a take id).
  const [busyTakeId, setBusyTakeId] = useState<string | null>(null);

  // Draft state: seeded from the last session take's voice when available.
  const [draft, setDraft] = useState<DraftState | null>(null);

  const activeSession = useMemo(() => (activeSessionId ? sessions?.find((s) => s.id === activeSessionId) : undefined), [activeSessionId, sessions]);

  const activeSessionGenerationIds = useMemo(() => asStringArray(activeSession?.generations), [activeSession]);

  const sessionGenerations = useMemo(() => activeSessionGenerationIds.map((genId) => generations?.find((g) => g.id === genId)).filter((g): g is NonNullable<typeof g> => Boolean(g)), [activeSessionGenerationIds, generations]);

  // Solo take scoped to the current page session — the id of a generation produced *in this tab*.
  // Null on initial load so reopening the app always lands on an empty composer.
  const [currentSoloId, setCurrentSoloId] = useState<string | null>(null);

  const currentSoloGeneration = useMemo(() => (currentSoloId ? generations?.find((g) => g.id === currentSoloId) : undefined), [currentSoloId, generations]);

  // Bumped every time we reset the draft content. Included in the draft <Take>'s key so the
  // Tiptap editor remounts with the fresh `initialContent` (Tiptap only reads `content:` on mount).
  const [draftVersion, setDraftVersion] = useState(0);

  // Whether to show the draft composer below the existing takes. Once at least one take exists,
  // we hide the draft by default and show only the dashed "Ajouter une prise" prompt — clicking
  // the prompt brings the composer back. Avoids the take + empty composer + dashed zone redundancy.
  const [wantsDraft, setWantsDraft] = useState(true);

  // Bank → document drag-and-drop state. Counter-based to handle nested dragenter/leave events
  // without the highlight flickering as the cursor moves over inner elements.
  const [bankDragDepth, setBankDragDepth] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  // Lifted so the 3-dot "Rename" menu (in the topbar) can flip the H1 (in the page body) into
  // edit mode from far away. Reset whenever the active session changes so we don't dangle in
  // editing mode after switching sessions.
  const [editingName, setEditingName] = useState(false);

  // Switching session resets the rename editor — otherwise we'd carry an open input over
  // when the user picks a different session from the sidebar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on session id only
  useEffect(() => {
    setEditingName(false);
  }, [activeSession?.id]);

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
          // Already in session mode — append the new take.
          const session = sessions?.find((s) => s.id === activeSessionId);
          if (session) {
            const nextGenerations = [...asStringArray(session.generations), generationId];
            await sessionCollection.update(activeSessionId, (s) => {
              s.generations = nextGenerations;
            }).isPersisted.promise;
          }
        } else if (currentSoloId && user) {
          // Auto-promote to session: the prior solo take is kept as #01, the new one as #02.
          // We deliberately *don't* clear currentSoloId here — TanStack DB delivers the new
          // session asynchronously, and clearing it before the session lands creates a render
          // where mainGenerations is empty and the draft visually jumps to position #01.
          // A useEffect clears it once the session is actually in the cache.
          const created = await pb.collection('sessions').create({
            name: '',
            user: user.id,
            generations: [currentSoloId, generationId],
          });
          setActiveSessionId(created.id);
        } else {
          // First generation of this page session — keep as solo above the composer.
          setCurrentSoloId(generationId);
        }
      }

      // Reset draft content, keep voice + tuning for the next take. Bumping the version forces
      // the Tiptap editor to remount so the blank content actually shows. Hide the draft so the
      // user can focus on tuning the just-generated take; the dashed prompt brings it back.
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
          // Session mode — swap the id at this slot.
          const session = sessions?.find((s) => s.id === activeSessionId);
          if (session) {
            const nextGenerations = asStringArray(session.generations).map((id) => (id === take.id ? generationId : id));
            await sessionCollection.update(activeSessionId, (s) => {
              s.generations = nextGenerations;
            }).isPersisted.promise;
          }
        } else if (currentSoloId === take.id) {
          // Solo mode — point the solo slot at the freshly-generated row, otherwise the take
          // card keeps playing the previous audio while the new one drifts into the bank.
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

  // Append a generation from the bank to the document. Mirrors the three-state logic of
  // `handleGenerate`: append in session mode, promote solo→session, or set as solo.
  const handleDropFromBank = useCallback(
    async (generationId: string) => {
      // Defensive — bank already filters out generations in the active session, but a stale
      // drag (snapshotted before a state update) could still try to add a duplicate.
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
      // No solo, no session — make this the solo take.
      setCurrentSoloId(generationId);
      setWantsDraft(false);
    },
    [activeSessionId, sessions, currentSoloId, user, setActiveSessionId, t],
  );

  // Drop-zone handlers. Use a depth counter (not a boolean) because dragenter/leave fire on every
  // child element the cursor crosses, and a naive boolean toggles to false the moment the cursor
  // moves over a Take card.
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

  // ⌘N — bring up the draft composer (and promote solo→session if needed). The handler closes
  // over `handleAddTake` declared just below; passing it directly keeps the keymap declarative.
  useKeyboardShortcut(() => handleAddTake(), { key: 'n' });

  async function handleAddTake() {
    // First and foremost: surface the draft composer.
    setWantsDraft(true);
    if (activeSession) {
      return;
    }
    if (!currentSoloGeneration) {
      // No solo to promote — empty state, the draft is now visible and ready.
      return;
    }
    if (!user) {
      toast.error(t('studio.notAuthenticated'));
      return;
    }
    // Promote the solo take into a fresh session so the next generation appends instead of
    // replacing it.
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
          <StudioTopbar sessionName={null} saved takeCount={0} inSession={false} />
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
  // Main column shows either the active session's takes, or — if no session — the take just
  // produced in this page session as a single take above the draft composer.
  const mainGenerations = activeSession ? sessionGenerations : currentSoloGeneration ? [currentSoloGeneration] : [];
  const mainTakes: TakeData[] = mainGenerations.map((gen, i) => generationToTake(gen, i + 1));
  const draftTake = makeDraftTake(mainTakes.length + 1, draftVersion, draft);
  // Show the draft composer only on the empty state or when the user has explicitly asked for it
  // (via "Ajouter une prise"). Avoids the redundant take + empty draft + dashed zone stack.
  const showDraft = mainTakes.length === 0 || wantsDraft;
  const displayTakes = showDraft ? [...mainTakes, draftTake] : mainTakes;
  const generatedCount = mainTakes.length;
  const showSessionTitle = Boolean(activeSession);

  // Bank: recent non-draft generations (skip ones already shown in the main column)
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
        />

        <main className="custom-scrollbar flex-1 overflow-y-auto" onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div className={cn(`mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6 md:py-10 ${isMobile ? 'pb-24' : ''}`, bankDragDepth > 0 && 'rounded-lg outline-2 outline-dashed outline-accent-amber/60 -outline-offset-8 bg-accent-amber/5')}>
            {showSessionTitle && <SessionTitle name={sessionNameDraft} onChange={setSessionNameDraft} editing={editingName} onEditingChange={setEditingName} />}

            {!activeSession && mainTakes.length === 0 && <EmptyState />}

            <ol className="space-y-4">
              {displayTakes.map((take) => {
                const isCurrentDraft = take.state === 'draft';
                const original = !isCurrentDraft ? generations?.find((g) => g.id === take.id) : undefined;
                // Resolve voice → model → backend → tuning capabilities so we can disable
                // sliders that wouldn't have any audible effect for the selected voice.
                const voice = voices.find((v) => v.id === take.voiceId);
                const modelEntry = voice ? catalog.find((m) => m.id === voice.model) : undefined;
                const capabilities = getVoiceCapabilities(modelEntry?.backend);
                return (
                  // Stable key by slot (not by generation id) so the Take instance survives a
                  // regeneration — internal state like the open/close of the tuning + timeline
                  // panels stays put while the underlying generation is swapped.
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

            {/* The dashed "Add take" zone and the draft composer are mutually exclusive — the
                composer already invites the user to enter the next take, so there's no need to
                stack a separate prompt below it. */}
            {generatedCount >= 1 && !showDraft && (
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
