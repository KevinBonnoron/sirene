import type { ApiKeyScope } from '@sirene/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CheckCircle2, Loader2, Terminal, XCircle } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cliAuthClient } from '@/clients/cli-auth.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScopePicker } from '@/components/user/api-keys-section';
import { explainApiError } from '@/lib/api-error';

export function CliAuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { code?: string };
  const [manualCode, setManualCode] = useState(search.code ?? '');
  const [confirmedCode, setConfirmedCode] = useState<string | null>(search.code ?? null);
  const nameInputId = useId();
  const codeInputId = useId();
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);
  const [fullAccess, setFullAccess] = useState(true);
  const [selectedScopes, setSelectedScopes] = useState<Set<ApiKeyScope>>(new Set());

  // Pre-fill the name with a sensible default once we have a confirmed code.
  useEffect(() => {
    if (confirmedCode && name === '') {
      setName(`CLI ${new Date().toISOString().slice(0, 10)}`);
    }
  }, [confirmedCode, name]);

  const lookup = useQuery({
    queryKey: ['cli-auth-lookup', confirmedCode],
    queryFn: () => (confirmedCode ? cliAuthClient.lookup(confirmedCode) : null),
    enabled: !!confirmedCode,
    retry: false,
  });

  const requestedScopes = useMemo<readonly ApiKeyScope[] | null>(() => lookup.data?.requestedScopes ?? null, [lookup.data]);

  // When the CLI requested a specific scope set, pre-select it and lock the
  // picker to that subset; the server enforces "granted ⊆ requested" anyway.
  // When the CLI requested nothing (null), default to full access.
  useEffect(() => {
    if (!lookup.data) {
      return;
    }
    if (requestedScopes !== null) {
      setFullAccess(false);
      setSelectedScopes(new Set(requestedScopes));
    } else {
      setFullAccess(true);
      setSelectedScopes(new Set());
    }
  }, [lookup.data, requestedScopes]);

  const approve = useMutation({
    // Mirror the server contract: `null` for full access, an array for an
    // explicit restricted set. The picker prevents submission with an empty
    // selection, so we never have to send `[]`.
    mutationFn: () => cliAuthClient.approve(confirmedCode ?? '', name.trim(), fullAccess ? null : Array.from(selectedScopes)),
    onSuccess: () => {
      setDone(true);
    },
    onError: (err) => toast.error(explainApiError(err, t('cliAuth.approveFailed'))),
  });

  // Initial state: no code yet (or invalid). Ask the user to paste the code
  // their terminal is showing.
  if (!confirmedCode) {
    return (
      <Card className="mx-auto mt-12 max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="size-5" />
            <CardTitle>{t('cliAuth.title')}</CardTitle>
          </div>
          <CardDescription>{t('cliAuth.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={codeInputId}>{t('cliAuth.codeLabel')}</Label>
            <Input id={codeInputId} autoFocus placeholder="ABCD-EFGH" value={manualCode} onChange={(e) => setManualCode(e.target.value.toUpperCase())} className="font-mono uppercase tracking-widest" />
          </div>
          <Button className="w-full" disabled={!manualCode.trim()} onClick={() => setConfirmedCode(manualCode.trim())}>
            {t('cliAuth.continue')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (lookup.isLoading) {
    return (
      <div className="mx-auto mt-12 flex max-w-md items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('cliAuth.loading')}
      </div>
    );
  }

  if (lookup.isError || !lookup.data) {
    return (
      <Card className="mx-auto mt-12 max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <XCircle className="size-5 text-destructive" />
            <CardTitle>{t('cliAuth.invalidTitle')}</CardTitle>
          </div>
          <CardDescription>{t('cliAuth.invalidDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setConfirmedCode(null)}>
            {t('cliAuth.tryAgain')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (lookup.data.status !== 'pending') {
    return (
      <Card className="mx-auto mt-12 max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-accent-sage" />
            <CardTitle>{t('cliAuth.alreadyDoneTitle')}</CardTitle>
          </div>
          <CardDescription>{t('cliAuth.alreadyDoneDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate({ to: '/' })}>
            {t('cliAuth.backHome')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="mx-auto mt-12 max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-accent-sage" />
            <CardTitle>{t('cliAuth.successTitle')}</CardTitle>
          </div>
          <CardDescription>{t('cliAuth.successDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate({ to: '/' })}>{t('cliAuth.backHome')}</Button>
        </CardContent>
      </Card>
    );
  }

  const canSubmit = name.trim().length > 0 && (fullAccess || selectedScopes.size > 0) && !approve.isPending;
  const scopesLocked = requestedScopes !== null;

  return (
    <Card className="mx-auto mt-12 max-w-md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Terminal className="size-5" />
          <CardTitle>{t('cliAuth.confirmTitle', { code: lookup.data.code })}</CardTitle>
        </div>
        <CardDescription>{t('cliAuth.confirmDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={nameInputId}>{t('cliAuth.nameLabel')}</Label>
          <Input id={nameInputId} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cliAuth.namePlaceholder')} />
          <p className="text-xs text-muted-foreground">{t('cliAuth.nameHint')}</p>
        </div>

        {scopesLocked && <p className="text-xs text-muted-foreground">{t('cliAuth.scopesRequestedHint')}</p>}
        <ScopePicker fullAccess={fullAccess && !scopesLocked} onFullAccessChange={scopesLocked ? () => {} : setFullAccess} selected={selectedScopes} onSelectedChange={setSelectedScopes} available={scopesLocked ? requestedScopes : undefined} />

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => navigate({ to: '/' })} disabled={approve.isPending}>
            {t('common.cancel')}
          </Button>
          <Button className="flex-1" onClick={() => approve.mutate()} disabled={!canSubmit}>
            {approve.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t('cliAuth.authorize')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
