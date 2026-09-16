import { eq, useLiveQuery } from '@tanstack/react-db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type AxisOptions, Chart } from 'react-charts';
import { useTranslation } from 'react-i18next';
import { HttpError } from 'universal-client';
import { inferenceDetailClient, inferenceStatsClient, type ServerStats, type StatsSample, type WorkerLogLine } from '@/clients/inference-stats.client';
import { inferenceServerCollection } from '@/collections';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useJobs } from '@/hooks/use-jobs';
import { useIsMobile } from '@/hooks/use-mobile';
import { openAuthenticatedStream } from '@/lib/auth-stream';
import { config } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme-provider';
import { formatFileSize, formatTime } from '@/utils/format';
import { ServerHeading } from './dashboard-page';

const MAX_LOG_LINES = 1000;
const logKey = (l: WorkerLogLine) => `${l.time}|${l.level}|${l.logger}|${l.message}`;

const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR'] as const;
const PERIODS = [5, 15, 60, 360] as const;
const LEVEL_CLASS: Record<string, string> = {
  DEBUG: 'text-dim',
  INFO: 'text-muted-foreground',
  WARNING: 'text-accent-rust',
  ERROR: 'text-destructive',
  CRITICAL: 'text-destructive',
};

const LEVEL_ON: Record<string, string> = {
  DEBUG: 'data-[state=on]:text-foreground',
  INFO: 'data-[state=on]:text-foreground',
  WARNING: 'data-[state=on]:text-accent-rust',
  ERROR: 'data-[state=on]:text-destructive',
};

function cssColor(variable: string, ..._invalidators: unknown[]): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '#d9a15e';
  }
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return ctx.fillStyle;
}

function unsupported(error: unknown): boolean {
  return error instanceof HttpError && (error.body as { code?: string } | null)?.code === 'inferenceServer.statsUnsupported';
}

type Point = { t: Date; v: number };

function SeriesChart({ label, points, unit, min, max, format, from, to }: { label: string; points: Point[]; unit: string; min?: number; max?: number; format: (v: number) => string; from: Date; to: Date }) {
  const { resolvedTheme, accent } = useTheme();
  const color = useMemo(() => cssColor('--primary', resolvedTheme, accent), [resolvedTheme, accent]);
  const [focused, setFocused] = useState<Point | null>(null);
  const last = points.at(-1);
  const shown = focused ?? last;
  const timeLabel = useMemo(() => new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }), []);
  const primaryAxis = useMemo<AxisOptions<Point>>(
    () => ({
      getValue: (d) => d.t,
      scaleType: 'localTime',
      show: true,
      hardMin: from,
      hardMax: to,
      formatters: { scale: (d: Date) => timeLabel.format(d), cursor: (d: Date) => timeLabel.format(d), tooltip: (d: Date) => timeLabel.format(d) },
    }),
    [timeLabel, from, to],
  );
  const secondaryAxes = useMemo<AxisOptions<Point>[]>(() => [{ getValue: (d) => d.v, elementType: 'line', min, max, formatters: { scale: (v: number) => format(v), tooltip: (v: number) => `${format(v)}${unit}` } }], [min, max, format, unit]);
  const data = useMemo(() => [{ label, data: points.length > 0 ? points : [{ t: new Date(), v: 0 }] }], [label, points]);
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">{label}</h3>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {focused && <span className="mr-2 text-dim">{timeLabel.format(focused.t)}</span>}
          {shown ? format(shown.v) : '—'}
          {unit && <span className="ml-0.5 text-dim">{unit}</span>}
        </span>
      </div>
      <div className="relative mt-3 h-40 w-full min-w-0">
        <Chart options={{ data, primaryAxis, secondaryAxes, dark: resolvedTheme === 'dark', padding: { left: 12, right: 12 }, primaryCursor: true, secondaryCursor: false, tooltip: false, onFocusDatum: (d) => setFocused(d ? d.originalDatum : null), getSeriesStyle: () => ({ color }) }} />
      </div>
    </div>
  );
}

export function ServerDetailPage({ serverId }: { serverId: string }) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { jobs } = useJobs();
  const { data: servers } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }).where(({ s }) => eq(s.id, serverId)));
  const server = servers?.[0];
  const online = !!server && server.lastHealth.status !== 'offline';
  const [levels, setLevels] = useState<string[]>([...LEVELS]);
  const [period, setPeriod] = useState<number>(15);

  const stats = useQuery({
    queryKey: ['inference-stats', serverId, 'history'],
    queryFn: () => inferenceStatsClient.get(serverId, true),
    enabled: online,
    retry: false,
  });
  const logs = useQuery({
    queryKey: ['inference-logs', serverId],
    queryFn: () => inferenceDetailClient.logs(serverId, 300),
    enabled: online,
    retry: false,
  });
  const [live, setLive] = useState<{ snapshot?: ServerStats; samples: StatsSample[]; lines: WorkerLogLine[] }>({ samples: [], lines: [] });

  useEffect(() => {
    setLive({ samples: [], lines: [] });
    if (!online) {
      return;
    }
    const stream = openAuthenticatedStream(`${config.server.url}/inference-servers/${encodeURIComponent(serverId)}/events`, ({ event, data }) => {
      if (event === 'sample') {
        const sample = JSON.parse(data) as StatsSample;
        setLive((l) => ({ ...l, samples: [...l.samples, sample] }));
      } else if (event === 'log') {
        const line = JSON.parse(data) as WorkerLogLine;
        setLive((l) => ({ ...l, lines: [...l.lines, line].slice(-MAX_LOG_LINES) }));
      } else if (event === 'stats') {
        setLive((l) => ({ ...l, snapshot: JSON.parse(data) as ServerStats }));
      }
    });
    return () => stream.close();
  }, [serverId, online]);

  const snapshot = live.snapshot ?? stats.data;
  const generations = useQuery({
    queryKey: ['inference-generations', serverId],
    queryFn: () => inferenceDetailClient.generations(serverId, 50),
    refetchInterval: 15_000,
  });

  const history = useMemo(() => {
    const base = stats.data?.history ?? [];
    const lastKnown = base.at(-1)?.t ?? 0;
    return [...base, ...live.samples.filter((s) => s.t > lastKnown)];
  }, [stats.data, live.samples]);
  const series = useMemo(() => {
    const to = Date.now();
    const since = to - period * 60_000;
    const window = history.filter((s) => s.t >= since);
    const pick = (key: keyof StatsSample) => window.filter((s) => s[key] !== null).map((s) => ({ t: new Date(s.t), v: Number(s[key]) }));
    return { from: new Date(since), to: new Date(to), cpu: pick('cpu'), memory: pick('memory'), gpu: pick('gpu'), vram: pick('vram') };
  }, [history, period]);
  const gpu = snapshot?.gpus[0];
  const running = jobs.filter((j) => j.status === 'running' && j.target?.endsWith(`::${serverId}`));
  const lines = useMemo(() => {
    const backlog = logs.data?.lines ?? [];
    // Millisecond timestamps collide, so the backlog and the live tail are merged on the whole entry.
    const seen = new Set(backlog.map(logKey));
    return [...backlog, ...live.lines.filter((l) => !seen.has(logKey(l)))].slice(-MAX_LOG_LINES).filter((l) => levels.includes(l.level === 'CRITICAL' ? 'ERROR' : l.level));
  }, [logs.data, live.lines, levels]);
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
  const timeFmt = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'medium' });
  const percent = (v: number) => `${Math.round(v)}`;

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar
        label={server?.name ?? t('nav.dashboard')}
        subtitle={server?.url}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/dashboard">
              <ChevronLeft className="size-4" />
              {t('nav.dashboard')}
            </Link>
          </Button>
        }
      />
      <main className={cn('custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6', isMobile && 'pb-24')}>
        {!server ? (
          <p className="text-sm text-muted-foreground">{t('inferenceServers.empty')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <ServerHeading server={server} device={snapshot?.device} />
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {t('dashboard.loadedModels')}: <span className="font-mono text-foreground">{snapshot?.loadedModels.length ? snapshot.loadedModels.join(', ') : t('dashboard.noneLoaded')}</span>
                </span>
                {snapshot && (
                  <span>
                    {t('dashboard.disk')}: <span className="font-mono text-foreground">{formatFileSize(snapshot.disk.used)}</span> / {formatFileSize(snapshot.disk.total)}
                  </span>
                )}
                {running.map((job) => (
                  <span key={job.id} className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" />
                    {job.label} · {job.progress}%
                  </span>
                ))}
              </div>
            </div>

            {online && (!stats.error || live.snapshot || history.length > 0) && (
              <ToggleGroup type="single" variant="outline" size="sm" value={String(period)} onValueChange={(v) => v && setPeriod(Number(v))} aria-label={t('dashboard.period')} className="self-end">
                {PERIODS.map((m) => (
                  <ToggleGroupItem key={m} value={String(m)} className="h-7 px-2.5 text-2xs">
                    {m < 60 ? t('dashboard.minutes', { count: m }) : t('dashboard.hours', { count: m / 60 })}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
            {!online ? (
              <p className="text-sm text-muted-foreground">{t('inferenceServers.statusOffline')}</p>
            ) : unsupported(stats.error) ? (
              <p className="text-sm text-muted-foreground">{t('dashboard.unavailable')}</p>
            ) : stats.error && !live.snapshot && history.length === 0 ? (
              <p className="text-sm text-accent-rust">{t('dashboard.error')}</p>
            ) : (
              <div className={cn('grid gap-4 md:grid-cols-2', gpu && 'xl:grid-cols-4')}>
                <SeriesChart label={t('dashboard.cpu')} points={series.cpu} from={series.from} to={series.to} unit="%" min={0} max={100} format={percent} />
                <SeriesChart label={t('dashboard.memory')} points={series.memory} from={series.from} to={series.to} unit="" format={(v) => formatFileSize(v)} />
                {gpu && <SeriesChart label={`${t('dashboard.gpu')} · ${gpu.name}`} points={series.gpu} from={series.from} to={series.to} unit="%" min={0} max={100} format={percent} />}
                {gpu && <SeriesChart label={t('dashboard.vram')} points={series.vram} from={series.from} to={series.to} unit="" max={gpu.memoryTotal} format={(v) => formatFileSize(v)} />}
              </div>
            )}

            <section className="space-y-2">
              <h2 className="px-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('dashboard.generations')}</h2>
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                {generations.data?.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('dashboard.noGenerations')}</p>}
                {generations.data?.map((g) => (
                  <div key={g.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                    <div className="text-xs text-muted-foreground">
                      <p>{dateFmt.format(new Date(g.created))}</p>
                      <p className="truncate font-medium text-foreground">{g.user.name || t('dashboard.unknownUser')}</p>
                    </div>
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="truncate">{g.text}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {g.voice.name || '—'} · {g.model}
                      </p>
                    </div>
                    <span className="row-start-1 font-mono text-xs text-dim sm:row-start-auto">{g.duration ? formatTime(g.duration) : '—'}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('dashboard.logs')}</h2>
                <ToggleGroup type="multiple" variant="outline" size="sm" value={levels} onValueChange={(next) => next.length > 0 && setLevels(next)} aria-label={t('dashboard.level')}>
                  {LEVELS.map((l) => (
                    <ToggleGroupItem key={l} value={l} className={cn('h-7 px-2.5 text-2xs text-muted-foreground', LEVEL_ON[l])}>
                      {t(`dashboard.levels.${l}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="custom-scrollbar max-h-[32rem] overflow-y-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-2xs leading-relaxed">
                {!online ? (
                  <p className="text-muted-foreground">{t('inferenceServers.statusOffline')}</p>
                ) : unsupported(logs.error) ? (
                  <p className="text-muted-foreground">{t('dashboard.logsUnavailable')}</p>
                ) : logs.error && live.lines.length === 0 ? (
                  <p className="text-accent-rust">{t('dashboard.error')}</p>
                ) : lines.length === 0 ? (
                  <p className="text-muted-foreground">{t('dashboard.noLogs')}</p>
                ) : (
                  lines.map((l) => (
                    <p key={logKey(l)} className={cn('whitespace-pre-wrap break-words', LEVEL_CLASS[l.level] ?? 'text-foreground')}>
                      <span className="text-dim">{timeFmt.format(new Date(l.time))}</span> <span className="font-semibold">{l.level.padEnd(7)}</span> <span className="text-dim">[{l.logger}]</span> {l.message}
                    </p>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
