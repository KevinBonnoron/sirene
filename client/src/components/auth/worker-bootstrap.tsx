import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkerState } from '@/hooks/use-worker-status';
import { cn } from '@/lib/utils';

const STEPS = ['python', 'dependencies', 'starting'] as const;

/** Shown in place of the app while the desktop's own worker cannot answer yet. */
export function WorkerBootstrap({ state }: { state: WorkerState | undefined }) {
  const { t } = useTranslation();
  const stage = state?.stage ?? 'pending';
  const failed = stage === 'failed';
  const current = STEPS.indexOf(stage as (typeof STEPS)[number]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <h1 className="font-serif text-2xl tracking-tight">{t(failed ? 'workerBootstrap.failedTitle' : 'workerBootstrap.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t(failed ? 'workerBootstrap.failedDescription' : 'workerBootstrap.description')}</p>

        {failed ? (
          <div className="mt-8 space-y-3">
            <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p className="break-words font-mono text-xs text-destructive">{state?.error}</p>
            </div>
            {state?.logFile && (
              <p className="text-xs text-muted-foreground">
                {t('workerBootstrap.logFile')} <code className="break-all font-mono">{state.logFile}</code>
              </p>
            )}
          </div>
        ) : (
          <ol className="mt-8 space-y-3">
            {STEPS.map((step, index) => {
              const done = current > index;
              const active = current === index;
              return (
                <li key={step} className={cn('flex items-center gap-3 text-sm', !done && !active && 'text-muted-foreground')}>
                  <span className="grid size-5 shrink-0 place-items-center">{done ? <Check className="size-4 text-accent-sage" /> : active ? <Loader2 className="size-4 animate-spin" /> : <span className="size-1.5 rounded-full bg-muted-foreground/40" />}</span>
                  {t(`workerBootstrap.steps.${step}`)}
                </li>
              );
            })}
          </ol>
        )}

        {!failed && state?.detail && (
          <p className="mt-6 truncate font-mono text-2xs text-muted-foreground" title={state.detail}>
            {state.detail}
          </p>
        )}
      </div>
    </div>
  );
}
