import type { InferenceServer } from '@sirene/shared';
import { useLiveQuery } from '@tanstack/react-db';
import { useQuery } from '@tanstack/react-query';
import { Cpu, HardDrive, Loader2, MemoryStick, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HttpError } from 'universal-client';
import { inferenceStatsClient } from '@/clients/inference-stats.client';
import { inferenceServerCollection } from '@/collections';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { Progress } from '@/components/ui/progress';
import { useJobs } from '@/hooks/use-jobs';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/format';

const REFRESH_MS = 5000;

function percentage(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}

function Gauge({ icon: Icon, label, value, detail }: { icon: typeof Cpu; label: string; value: number; detail: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </span>
        <span className="font-mono tabular-nums">{pct}%</span>
      </div>
      <Progress value={pct} className={cn('h-1.5', pct >= 90 && '[&>div]:bg-destructive')} />
      <p className="font-mono text-2xs text-dim">{detail}</p>
    </div>
  );
}

function ServerCard({ server }: { server: InferenceServer }) {
  const { t } = useTranslation();
  const { jobs } = useJobs();
  const online = server.lastHealth.status !== 'offline';
  const { data, isLoading, error } = useQuery({
    queryKey: ['inference-stats', server.id],
    queryFn: () => inferenceStatsClient.get(server.id),
    enabled: online,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const running = jobs.filter((j) => j.status === 'running' && j.target?.endsWith(`::${server.id}`));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 rounded-full', online ? 'bg-accent-sage' : 'bg-destructive')} aria-hidden />
        <h3 className="font-serif text-base tracking-tight">{server.name}</h3>
        {data && <span className={cn('rounded px-1 py-px text-2xs font-medium', data.device === 'cpu' ? 'bg-accent-sage/15 text-accent-sage' : 'bg-primary/15 text-primary')}>{data.device === 'cpu' ? t('inferenceServers.deviceCpu') : t('inferenceServers.deviceGpu', { device: data.device })}</span>}
      </div>
      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{server.url}</p>

      {!online ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('inferenceServers.statusOffline')}</p>
      ) : isLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('dashboard.loading')}
        </p>
      ) : error instanceof HttpError && (error.body as { code?: string } | null)?.code === 'inferenceServer.statsUnsupported' ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('dashboard.unavailable')}</p>
      ) : error || !data ? (
        <p className="mt-4 text-sm text-accent-rust">{t('dashboard.error')}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <Gauge icon={Cpu} label={t('dashboard.cpu')} value={data.cpu.percent} detail={t('dashboard.cores', { count: data.cpu.cores })} />
          <Gauge icon={MemoryStick} label={t('dashboard.memory')} value={percentage(data.memory.used, data.memory.total)} detail={`${formatFileSize(data.memory.used)} / ${formatFileSize(data.memory.total)}`} />
          {data.gpus.map((gpu) => (
            <div key={gpu.index} className="space-y-4">
              <Gauge icon={Zap} label={`${t('dashboard.gpu')} · ${gpu.name}`} value={gpu.utilization} detail={t('dashboard.gpuUtilization')} />
              <Gauge icon={MemoryStick} label={t('dashboard.vram')} value={percentage(gpu.memoryUsed, gpu.memoryTotal)} detail={`${formatFileSize(gpu.memoryUsed)} / ${formatFileSize(gpu.memoryTotal)}`} />
            </div>
          ))}
          <Gauge icon={HardDrive} label={t('dashboard.disk')} value={percentage(data.disk.used, data.disk.total)} detail={`${formatFileSize(data.disk.used)} / ${formatFileSize(data.disk.total)}`} />
          <div className="space-y-1 text-xs">
            <p className="text-muted-foreground">{t('dashboard.loadedModels')}</p>
            {data.loadedModels.length === 0 ? (
              <p className="text-dim">{t('dashboard.noneLoaded')}</p>
            ) : (
              data.loadedModels.map((m) => (
                <p key={m} className="font-mono">
                  {m}
                </p>
              ))
            )}
          </div>
          {running.length > 0 && (
            <div className="space-y-1 text-xs">
              <p className="text-muted-foreground">{t('dashboard.activity')}</p>
              {running.map((job) => (
                <p key={job.id} className="flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{job.label}</span>
                  <span className="font-mono text-dim">{job.progress}%</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { data: serversData } = useLiveQuery((q) =>
    q
      .from({ s: inferenceServerCollection })
      .where(({ s }) => s.enabled)
      .orderBy(({ s }) => s.priority, 'desc'),
  );
  const servers = serversData ?? [];

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar label={t('nav.dashboard')} subtitle={t('dashboard.subtitle')} />
      <main className={cn('custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6', isMobile && 'pb-24')}>
        {servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('inferenceServers.empty')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {servers.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
