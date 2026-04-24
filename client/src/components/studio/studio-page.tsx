import { Link } from '@tanstack/react-router';
import { AudioLines, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useIsDesktop, useIsMobile } from '@/hooks/use-mobile';
import { StudioTopbar } from './studio-topbar';
import { Take, type TakeData } from './take';
import { type BankEntry, TakeBank } from './take-bank';

// TODO phase 2 — replace mocks with real Session + Take collections (TanStack DB)
const MOCK_READY_TAKES: TakeData[] = [
  {
    id: 'take-1',
    orderIndex: 1,
    state: 'ready',
    voiceName: 'Alice',
    modelName: 'qwen3-tts-1.7B',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: "Bonjour à tous, je suis ravie de vous présenter aujourd'hui notre nouveau produit. " },
            {
              type: 'text',
              text: 'Prenez un moment',
              marks: [{ type: 'speedMark', attrs: { rate: 0.75 } }],
            },
            { type: 'text', text: ' pour imaginer ce que cela pourrait changer.' },
          ],
        },
      ],
    },
    duration: 7.4,
    tuning: { pitchShift: 0, speedMultiplier: 1, variationSeed: 0.5 },
  },
  {
    id: 'take-2',
    orderIndex: 2,
    state: 'tuned',
    voiceName: 'Alice',
    modelName: 'qwen3-tts-1.7B',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Notre solution',
              marks: [{ type: 'toneMark', attrs: { tone: 'excited' } }],
            },
            { type: 'text', text: ' répond à un besoin que vous connaissez tous. ' },
            { type: 'effectNode', attrs: { effect: 'pause', label: 'pause' } },
            { type: 'text', text: ' Laissez-moi vous expliquer.' },
          ],
        },
      ],
    },
    duration: 6.1,
    tuning: { pitchShift: 0.5, speedMultiplier: 0.95, variationSeed: 0.5 },
  },
];

function makeDraft(orderIndex: number, voiceName = 'Alice', modelName = 'qwen3-tts-1.7B'): TakeData {
  return {
    id: `take-draft-${orderIndex}`,
    orderIndex,
    state: 'draft',
    voiceName,
    modelName,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    tuning: { pitchShift: 0, speedMultiplier: 1, variationSeed: 0.5 },
  };
}

const MOCK_BANK: BankEntry[] = [
  {
    id: 'bank-1',
    voiceName: 'Alice',
    modelName: 'qwen3-tts',
    text: "Bonjour à tous, je suis ravie de vous présenter aujourd'hui notre nouveau produit.",
    duration: 7.4,
    createdAt: new Date(Date.now() - 1000 * 60 * 3),
  },
  {
    id: 'bank-2',
    voiceName: 'Alice',
    modelName: 'qwen3-tts',
    text: 'Notre solution répond à un besoin que vous connaissez tous.',
    duration: 6.1,
    createdAt: new Date(Date.now() - 1000 * 60 * 5),
  },
  {
    id: 'bank-3',
    voiceName: 'Bob',
    modelName: 'piper-fr',
    text: 'Test de voix alternative pour le dialogue.',
    duration: 3.2,
    createdAt: new Date(Date.now() - 1000 * 60 * 42),
  },
];

type Variant = 'no-voices' | 'empty' | 'single' | 'multi';

function getTakesForVariant(variant: Variant): TakeData[] {
  if (variant === 'no-voices') {
    return [];
  }
  if (variant === 'empty') {
    return [makeDraft(1)];
  }
  if (variant === 'single') {
    return [MOCK_READY_TAKES[0], makeDraft(2)];
  }
  return [...MOCK_READY_TAKES, makeDraft(3)];
}

export function StudioPage() {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();

  // TODO phase 2 — replace with real session/takes
  const [variant, setVariant] = useState<Variant>('multi');
  const [sessionName, setSessionName] = useState<string | null>('Présentation investisseurs');
  const takes = getTakesForVariant(variant);
  const generatedCount = takes.filter((take) => take.state !== 'draft').length;
  const [bankEntries] = useState<BankEntry[]>(variant === 'empty' || variant === 'no-voices' ? [] : MOCK_BANK);
  const showSessionTitle = variant === 'multi';

  return (
    <div className="flex h-svh overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <StudioTopbar sessionName={showSessionTitle ? sessionName : null} onSessionNameChange={setSessionName} saved takeCount={generatedCount} />

        {/* Dev variant switcher — TODO phase 2: remove */}
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle bg-bg-elevated/40 px-3 py-1 text-[10px] text-dim sm:px-4">
          <span className="shrink-0 uppercase tracking-wider">dev · variant</span>
          {(['no-voices', 'empty', 'single', 'multi'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVariant(v)} className={variant === v ? 'shrink-0 rounded bg-accent-amber/20 px-2 py-0.5 text-accent-amber' : 'shrink-0 rounded px-2 py-0.5 hover:bg-card'}>
              {v}
            </button>
          ))}
        </div>

        <main className="custom-scrollbar flex-1 overflow-y-auto">
          <div className={`mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6 md:py-10 ${isMobile ? 'pb-24' : ''}`}>
            {variant === 'no-voices' ? (
              <NoVoicesState />
            ) : (
              <>
                {variant === 'empty' && <EmptyState />}

                {showSessionTitle && <h1 className="mb-6 font-serif text-2xl tracking-tight sm:text-3xl">{sessionName ?? <span className="italic text-dim">{t('studio.untitledSession')}</span>}</h1>}

                <ol className="space-y-4">
                  {takes.map((take) => (
                    <li key={take.id}>
                      <Take take={take} />
                    </li>
                  ))}
                </ol>

                {generatedCount >= 1 && (
                  <button type="button" className="mt-4 flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-accent-amber/60 hover:bg-card/40 hover:text-foreground">
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
              </>
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
