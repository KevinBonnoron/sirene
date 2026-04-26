import type { Job } from '@sirene/shared';
import { Bell, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useJobs } from '@/hooks/use-jobs';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const { t } = useTranslation();
  const { jobs, dismiss } = useJobs();

  const runningCount = jobs.filter((j) => j.status === 'running').length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-9" aria-label={t('notifications.open')}>
          <Bell className="size-4" />
          {runningCount > 0 && <span className="absolute right-1 top-1 inline-flex size-1.5 rounded-full bg-accent-amber" aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-80 p-0">
        <DropdownMenuLabel className="px-3 py-2 text-xs font-semibold text-muted-foreground">{t('notifications.title')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {jobs.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('notifications.empty')}</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} onDismiss={() => dismiss(job.id)} />
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function JobRow({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const { t } = useTranslation();
  const Icon = job.status === 'running' ? Loader2 : job.status === 'completed' ? CheckCircle2 : XCircle;
  const iconColor = job.status === 'completed' ? 'text-accent-sage' : job.status === 'failed' ? 'text-destructive' : 'text-muted-foreground';
  const statusLabel = t(`notifications.${job.status}`);
  const canDismiss = job.status !== 'running';

  return (
    <li className="group flex flex-col gap-1.5 px-3 py-2 hover:bg-accent/40">
      <div className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 size-3.5 shrink-0', iconColor, job.status === 'running' && 'animate-spin')} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={job.label}>
            {job.label}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{statusLabel}</p>
        </div>
        {canDismiss && (
          <button type="button" onClick={onDismiss} aria-label={t('notifications.dismiss')} className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {job.status === 'running' && <Progress value={job.progress} className="h-1" />}
      {job.status === 'failed' && job.error && <p className="truncate text-[10px] text-destructive">{job.error}</p>}
    </li>
  );
}
