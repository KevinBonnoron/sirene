import { Box, Check, ChevronDown, Cloud, Copy, Cpu, ExternalLink, Layers, Loader2, type LucideIcon, Terminal, TrainFront, Zap } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { inferenceServerClient } from '@/clients/inference-server.client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { explainApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Inference mode landed after the v0.0.1 tag was cut, so there is no tagged
// release the installer can be pinned to today. Use `main` and surface a
// security note in the dialog hint; once an inference-capable release exists
// this should switch back to a fetched-version-based pin (the /version
// endpoint is already wired).
const INSTALL_REF = 'main';
const INSTALL_URL = `https://raw.githubusercontent.com/KevinBonnoron/sirene/${INSTALL_REF}/install.sh`;
const IMAGE = 'ghcr.io/kevinbonnoron/sirene-inference';
const RAILWAY_TEMPLATE_URL = 'https://railway.com/deploy/sirene-inference?utm_medium=integration&utm_source=button&utm_campaign=sirene';

const PLATFORMS = ['linux', 'docker', 'compose', 'railway', 'runpod'] as const;
type Platform = (typeof PLATFORMS)[number];
const DEVICES = ['cpu', 'cuda'] as const;
type Device = (typeof DEVICES)[number];

const PLATFORM_ICONS: Record<Platform, LucideIcon> = { linux: Terminal, docker: Box, compose: Layers, railway: TrainFront, runpod: Cloud };
const DEVICE_ICONS: Record<Device, LucideIcon> = { cpu: Cpu, cuda: Zap };
const FIXED_DEVICE: Partial<Record<Platform, Device>> = { railway: 'cpu', runpod: 'cuda' };

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

interface Snippet {
  text: string;
  multiline: boolean;
}

function buildSnippet(platform: Platform, device: Device, sireneUrl: string, registrationToken: string, workerToken: string): Snippet {
  const image = `${IMAGE}:${device === 'cuda' ? 'cuda' : 'latest'}`;
  switch (platform) {
    case 'linux':
      return { text: `curl -sSL ${INSTALL_URL} | INSTALL_MODE=inference DEVICE=${device} SIRENE_URL=${sireneUrl} SIRENE_REGISTRATION_TOKEN=${registrationToken} bash`, multiline: false };
    case 'docker':
      return {
        multiline: true,
        text: [
          'docker run -d --name sirene-inference --restart unless-stopped \\',
          `  -p 8000:8000${device === 'cuda' ? ' --gpus all' : ''} \\`,
          `  -e INFERENCE_AUTH_TOKEN=${workerToken} \\`,
          `  -e SIRENE_URL=${sireneUrl} \\`,
          `  -e SIRENE_REGISTRATION_TOKEN=${registrationToken} \\`,
          '  -e INFERENCE_PUBLIC_URL=http://<this-machine>:8000 \\',
          '  -v sirene-inference-data:/app/data \\',
          `  ${image}`,
        ].join('\n'),
      };
    case 'compose':
      return {
        multiline: true,
        text: [
          'services:',
          '  inference:',
          `    image: ${image}`,
          '    ports:',
          '      - "8000:8000"',
          '    environment:',
          `      INFERENCE_AUTH_TOKEN: ${workerToken}`,
          `      SIRENE_URL: ${sireneUrl}`,
          `      SIRENE_REGISTRATION_TOKEN: ${registrationToken}`,
          '      INFERENCE_PUBLIC_URL: http://<this-machine>:8000',
          '    volumes:',
          '      - sirene-inference-data:/app/data',
          ...(device === 'cuda' ? ['    deploy:', '      resources:', '        reservations:', '          devices:', '            - capabilities: [gpu]'] : []),
          '    restart: unless-stopped',
          'volumes:',
          '  sirene-inference-data:',
        ].join('\n'),
      };
    case 'railway':
      return { multiline: true, text: [`SIRENE_URL=${sireneUrl}`, `SIRENE_REGISTRATION_TOKEN=${registrationToken}`].join('\n') };
    case 'runpod':
      return {
        multiline: true,
        text: [`SIRENE_URL=${sireneUrl}`, `SIRENE_REGISTRATION_TOKEN=${registrationToken}`, `INFERENCE_AUTH_TOKEN=${workerToken}`].join('\n'),
      };
  }
}

function ChoiceRow<T extends string>({ label, options, value, icons, onChange, t }: { label: string; options: readonly T[]; value: T; icons: Record<T, LucideIcon>; onChange: (v: T) => void; t: (key: string) => string }) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {options.map((option) => {
          const Icon: LucideIcon = icons[option];
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option)}
              className={cn('flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm transition-colors', active ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border bg-background text-foreground hover:bg-accent')}
            >
              <Icon className="size-4" />
              {t(option)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SnippetBlock({ snippet, hint }: { snippet: Snippet; hint: ReactNode }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(snippet.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className={cn('flex gap-2 rounded-md border border-border-subtle bg-background/50 py-1.5 pr-1.5 pl-3', snippet.multiline ? 'items-start' : 'items-center')}>
        <code className={cn('block min-w-0 flex-1 font-mono text-2xs', snippet.multiline ? 'overflow-x-auto whitespace-pre leading-relaxed py-1.5' : 'truncate leading-none')} title={snippet.multiline ? undefined : snippet.text}>
          {snippet.text}
        </code>
        <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={copy} aria-label={t('studio.copy')}>
          {copied ? <Check className="size-3.5 text-accent-sage" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function AddServerDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const [workerToken, setWorkerToken] = useState(randomToken);
  const [platform, setPlatform] = useState<Platform>('linux');
  const [device, setDevice] = useState<Device>('cpu');
  const [manualOpen, setManualOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [priority, setPriority] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setWorkerToken(randomToken());
      setRegistrationToken(null);
      setTokenError(false);
      setPlatform('linux');
      setDevice('cpu');
      setManualOpen(false);
      setName('');
      setUrl('');
      setAuthToken('');
      setPriority('0');
      setEnabled(true);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const issue = () => {
      inferenceServerClient
        .createRegistrationToken()
        .then((res) => {
          if (cancelled) {
            return;
          }
          setRegistrationToken(res.token);
          setTokenError(false);
          const ttl = new Date(res.expiresAt).getTime() - Date.now() - 60_000;
          timer = setTimeout(issue, Math.max(ttl, 5_000));
        })
        .catch(() => {
          if (!cancelled) {
            setTokenError(true);
            timer = setTimeout(issue, 10_000);
          }
        });
    };
    issue();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open]);

  const effectiveDevice = FIXED_DEVICE[platform] ?? device;
  const snippet = registrationToken ? buildSnippet(platform, effectiveDevice, window.location.origin, registrationToken, workerToken) : null;

  async function handleSubmit() {
    if (saving || !name.trim() || !url.trim()) {
      return;
    }
    setSaving(true);
    try {
      await inferenceServerClient.create({
        name: name.trim(),
        url: url.trim().replace(/\/$/, ''),
        enabled,
        priority: Number.parseInt(priority, 10) || 0,
        authToken: authToken.trim() || undefined,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(explainApiError(e, t('inferenceServers.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl sm:grid-cols-[minmax(0,1fr)]">
        <DialogHeader className="min-w-0">
          <DialogTitle>{t('inferenceServers.addDialog.title')}</DialogTitle>
          <DialogDescription>{t('inferenceServers.addDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <ChoiceRow label={t('inferenceServers.addDialog.platform')} options={PLATFORMS} value={platform} icons={PLATFORM_ICONS} onChange={setPlatform} t={(k) => t(`inferenceServers.addDialog.platforms.${k}`)} />
          {!FIXED_DEVICE[platform] && <ChoiceRow label={t('inferenceServers.addDialog.device')} options={DEVICES} value={device} icons={DEVICE_ICONS} onChange={setDevice} t={(k) => t(`inferenceServers.addDialog.devices.${k}`)} />}
        </div>

        {tokenError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t('inferenceServers.addDialog.tokenFailed')}
          </p>
        ) : snippet === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('inferenceServers.addDialog.tokenLoading')}
          </p>
        ) : (
          <>
            {platform === 'railway' && (
              <Button asChild className="w-fit">
                <a href={RAILWAY_TEMPLATE_URL} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  {t('inferenceServers.addDialog.deployOnRailway')}
                </a>
              </Button>
            )}
            <SnippetBlock snippet={snippet} hint={t(`inferenceServers.addDialog.hints.${platform}`, { image: `${IMAGE}:${effectiveDevice === 'cuda' ? 'cuda' : 'latest'}` })} />
          </>
        )}
        <p className="text-xs text-muted-foreground">{t('inferenceServers.addDialog.tokenHint')}</p>

        <div>
          <button type="button" className="flex w-full items-center gap-1.5 text-left text-sm font-medium" aria-expanded={manualOpen} onClick={() => setManualOpen((v) => !v)}>
            <ChevronDown className={cn('size-4 transition-transform', !manualOpen && '-rotate-90')} />
            {t('inferenceServers.addDialog.manualLabel')}
          </button>
          <p className="mt-1 pl-5.5 text-2xs text-muted-foreground">{t('inferenceServers.addDialog.manualHint')}</p>
        </div>

        {manualOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-name">{t('inferenceServers.name')}</Label>
                <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('inferenceServers.namePlaceholder')} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-url">{t('inferenceServers.url')}</Label>
                <Input id="add-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('inferenceServers.urlPlaceholder')} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="add-token">{t('inferenceServers.authToken')}</Label>
                <Input id="add-token" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={t('inferenceServers.authTokenPlaceholder')} className="font-mono text-xs" />
                <p className="text-2xs text-muted-foreground">{t('inferenceServers.authTokenHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-priority">{t('inferenceServers.priority')}</Label>
                <Input id="add-priority" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
                <p className="text-2xs text-dim">{t('inferenceServers.priorityHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-enabled">{t('inferenceServers.enabled')}</Label>
                <div className="flex h-9 items-center">
                  <Switch id="add-enabled" checked={enabled} onCheckedChange={setEnabled} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving || !name.trim() || !url.trim()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
