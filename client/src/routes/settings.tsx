import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Eye, EyeOff, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { type SettingEntry, settingsClient } from '@/clients/settings.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

const KEYS = [
  { key: 'openai_api_key', labelKey: 'settings.openAIKey', placeholder: 'sk-...' },
  { key: 'elevenlabs_api_key', labelKey: 'settings.elevenLabsKey', placeholder: 'sk-...' },
  { key: 'hf_token', labelKey: 'settings.hfToken', placeholder: 'hf_...' },
] as const;

function ApiKeyField({ keyDef, settings }: { keyDef: (typeof KEYS)[number]; settings: SettingEntry[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const existing = settings.find((s) => s.key === keyDef.key);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dirty = value.length > 0;

  async function handleDelete() {
    setDeleting(true);
    try {
      await settingsClient.remove(keyDef.key);
      toast.success(t('settings.removed', { key: t(keyDef.labelKey) }));
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.removeFailed'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await settingsClient.update(keyDef.key, value.trim());
      toast.success(t('settings.saved', { key: t(keyDef.labelKey) }));
      setValue('');
      setEditing(false);
      setVisible(false);
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (existing && !editing) {
    return (
      <div className="space-y-2">
        <Label>{t(keyDef.labelKey)}</Label>
        <div className="flex gap-2">
          <Input readOnly value={existing.maskedValue} className="flex-1 font-mono text-muted-foreground" />
          <Button onClick={() => setEditing(true)} size="icon" variant="outline">
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
          <Input type={visible ? 'text' : 'password'} placeholder={keyDef.placeholder} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && dirty && handleSave()} autoFocus={editing} />
          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground" onClick={() => setVisible((v) => !v)}>
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

function SettingsPage() {
  const { t } = useTranslation();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsClient.getAll(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.apiKeys')}</CardTitle>
            <CardDescription>{t('settings.apiKeysDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {KEYS.map((keyDef) => (
              <ApiKeyField key={keyDef.key} keyDef={keyDef} settings={settings ?? []} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
