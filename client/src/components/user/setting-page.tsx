import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Eye, EyeOff, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import { useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { type SettingEntry, settingsClient } from '@/clients/settings.client';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { ApiKeysSection } from './api-keys-section';
import { InferenceServersSection } from './inference-servers-section';

const KEYS = [
  { key: 'openai_api_key', labelKey: 'settings.openAIKey', placeholder: 'sk-...' },
  { key: 'elevenlabs_api_key', labelKey: 'settings.elevenLabsKey', placeholder: 'sk-...' },
  { key: 'hf_token', labelKey: 'settings.hfToken', placeholder: 'hf_...' },
] as const;

/** Tab identifiers used both in the page and in the route's search-param
 *  validator. Adding a tab is a compile-time event in both places. */
export const SETTINGS_TABS = ['inference-servers', 'api-keys', 'cloud-keys'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const DEFAULT_TAB: SettingsTab = 'inference-servers';

type ApiKeyState = { editing: boolean; value: string; visible: boolean; saving: boolean; deleting: boolean };
type ApiKeyAction = { type: 'startEdit' } | { type: 'setValue'; value: string } | { type: 'toggleVisible' } | { type: 'startSave' } | { type: 'saveDone' } | { type: 'startDelete' } | { type: 'deleteDone' };

function apiKeyReducer(state: ApiKeyState, action: ApiKeyAction): ApiKeyState {
  switch (action.type) {
    case 'startEdit':
      return { ...state, editing: true };
    case 'setValue':
      return { ...state, value: action.value };
    case 'toggleVisible':
      return { ...state, visible: !state.visible };
    case 'startSave':
      return { ...state, saving: true };
    case 'saveDone':
      return { ...state, saving: false, editing: false, value: '', visible: false };
    case 'startDelete':
      return { ...state, deleting: true };
    case 'deleteDone':
      return { ...state, deleting: false };
  }
}

function ApiKeyField({ keyDef, settings }: { keyDef: (typeof KEYS)[number]; settings: SettingEntry[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const existing = settings.find((s) => s.key === keyDef.key);
  const inputRef = useRef<HTMLInputElement>(null);
  const [{ editing, value, visible, saving, deleting }, dispatch] = useReducer(apiKeyReducer, {
    editing: false,
    value: '',
    visible: false,
    saving: false,
    deleting: false,
  });
  const dirty = value.length > 0;

  async function handleDelete() {
    dispatch({ type: 'startDelete' });
    try {
      await settingsClient.remove(keyDef.key);
      toast.success(t('settings.removed', { key: t(keyDef.labelKey) }));
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.removeFailed'));
    } finally {
      dispatch({ type: 'deleteDone' });
    }
  }

  async function handleSave() {
    if (!value.trim()) {
      return;
    }
    dispatch({ type: 'startSave' });
    try {
      await settingsClient.update(keyDef.key, value.trim());
      toast.success(t('settings.saved', { key: t(keyDef.labelKey) }));
      dispatch({ type: 'saveDone' });
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.saveFailed'));
      dispatch({ type: 'deleteDone' });
    }
  }

  if (existing && !editing) {
    return (
      <div className="space-y-2">
        <Label>{t(keyDef.labelKey)}</Label>
        <div className="flex gap-2">
          <Input readOnly value={existing.maskedValue} className="flex-1 font-mono text-muted-foreground" />
          <Button
            onClick={() => {
              dispatch({ type: 'startEdit' });
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            size="icon"
            variant="outline"
          >
            <Pencil className="size-4" />
          </Button>
          <Button onClick={handleDelete} disabled={deleting} size="icon" variant="outline" className="text-muted-foreground hover:text-destructive">
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>{t(keyDef.labelKey)}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            type={visible ? 'text' : 'password'}
            placeholder={keyDef.placeholder}
            value={value}
            onChange={(e) => dispatch({ type: 'setValue', value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty) {
                handleSave();
              }
            }}
          />
          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground" onClick={() => dispatch({ type: 'toggleVisible' })}>
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
        <Button onClick={handleSave} disabled={!dirty || saving} size="icon" variant="outline">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

function CloudKeysSection() {
  const { t } = useTranslation();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsClient.getAll(),
  });

  if (isLoading) {
    return <Skeleton className="h-48" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.cloudKeys.title')}</CardTitle>
        <CardDescription>{t('settings.cloudKeys.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {KEYS.map((keyDef) => (
          <ApiKeyField key={keyDef.key} keyDef={keyDef} settings={settings ?? []} />
        ))}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const navigate = useNavigate({ from: '/settings' });
  const search = useSearch({ from: '/_app/settings' }) as { tab?: SettingsTab };
  const activeTab: SettingsTab = search.tab ?? DEFAULT_TAB;

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar label={t('nav.settings')} subtitle={t('settings.subtitle')} />
      <main className={`custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-6 ${isMobile ? 'pb-24' : ''}`}>
        <Tabs
          value={activeTab}
          onValueChange={(next) => {
            // Drop the search param entirely when the user lands back on the
            // default so the URL stays clean (`/settings` vs `/settings?tab=inference-servers`).
            navigate({ search: next === DEFAULT_TAB ? {} : { tab: next as SettingsTab }, replace: true });
          }}
        >
          <TabsList>
            <TabsTrigger value="inference-servers">{t('settings.tabs.inferenceServers')}</TabsTrigger>
            <TabsTrigger value="api-keys">{t('settings.tabs.apiKeys')}</TabsTrigger>
            <TabsTrigger value="cloud-keys">{t('settings.tabs.cloudKeys')}</TabsTrigger>
          </TabsList>

          <TabsContent value="inference-servers">
            <InferenceServersSection />
          </TabsContent>
          <TabsContent value="api-keys">
            <ApiKeysSection />
          </TabsContent>
          <TabsContent value="cloud-keys">
            <CloudKeysSection />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
