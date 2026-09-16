import type { InferenceServer } from '@sirene/shared';
import { Cpu, HardDrive, Loader2, MemoryStick, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useJobs } from '@/hooks/use-jobs';
import type { ServerEventsFeed } from '@/hooks/use-server-events';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/format';

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

export function GaugesSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-8" />
          </div>
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function ServerGauges({ server, feed }: { server: InferenceServer; feed: ServerEventsFeed }) {
  const { t } = useTranslation();
  const { jobs } = useJobs();
  const { snapshot: data, status } = feed;
  const running = jobs.filter((j) => j.status === 'running' && j.target?.endsWith(`::${server.id}`));

  if (status === 'unsupported') {
    return <p className="text-sm text-muted-foreground">{t('dashboard.unavailable')}</p>;
  }
  if (status === 'error' && !data) {
    return <p className="text-sm text-accent-rust">{t('dashboard.error')}</p>;
  }
  if (!data) {
    return <GaugesSkeleton />;
  }
  return (
    <div className="space-y-4">
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
  );
}

export function ServerHeading({ server, device }: { server: InferenceServer; device?: string }) {
  const { t } = useTranslation();
  const online = server.lastHealth.status === 'online';
  const dev = device ?? server.lastHealth.device;
  const gpu = !!dev && dev !== 'cpu';
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('size-2 shrink-0 rounded-full', online ? 'bg-accent-sage' : server.lastHealth.status === 'offline' ? 'bg-destructive' : 'bg-muted-foreground/40')} aria-hidden />
        <h3 className="font-serif text-base tracking-tight">{server.name}</h3>
        {!server.enabled && <span className="rounded bg-muted px-1 py-px text-2xs font-medium text-muted-foreground">{t('inferenceServers.disabled')}</span>}
        {dev && (
          <span className={cn('inline-flex items-center gap-1 rounded px-1 py-px text-2xs font-medium', gpu ? 'bg-primary/15 text-primary' : 'bg-accent-sage/15 text-accent-sage')}>
            {gpu ? <Zap className="size-2.5" /> : <Cpu className="size-2.5" />}
            {gpu ? t('inferenceServers.deviceGpu', { device: dev }) : t('inferenceServers.deviceCpu')}
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={server.url}>
        {server.url}
      </p>
    </div>
  );
}
