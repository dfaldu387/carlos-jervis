import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { formatTime } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/states';
import type { ConnectorMode, Integration } from '@/lib/types';
import { useT } from '@/lib/i18n';

const modeBadge: Record<ConnectorMode, { variant: BadgeProps['variant']; label: string }> = {
  live: { variant: 'success', label: 'mode.short.live' },
  mock: { variant: 'warning', label: 'mode.short.mock' },
  planned: { variant: 'muted', label: 'mode.short.planned' },
};

function IntegrationCard({ integration, onChanged }: { integration: Integration; onChanged: () => void }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    integration.fields.forEach((f) => (seed[f.key] = f.secret ? '' : (f.value ?? '')));
    return seed;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; mode: string; detail?: string; latencyMs?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const planned = integration.mode === 'planned';
  const missing = integration.fields.filter((f) => f.required).filter((f) => (f.secret ? !f.set && !values[f.key] : !values[f.key]));
  const m = modeBadge[integration.mode];

  const save = async (enabled = integration.enabled) => {
    setBusy('save');
    setError(null);
    try {
      const payload: { enabled: boolean; values: Record<string, string> } = { enabled, values: {} };
      integration.fields.forEach((f) => {
        const v = values[f.key] ?? '';
        if (f.secret && v === '') return;
        payload.values[f.key] = v;
      });
      await api.saveIntegration(integration.id, payload);
      setTest(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('integrations.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setError(null);
    setTest(null);
    try {
      const { result } = await api.testIntegration(integration.id);
      setTest(result);
      if (result.mode === 'live') onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('integrations.testFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="text-base font-semibold text-foreground">{integration.name}</div>
        <Badge variant={m.variant}>{t(m.label)}</Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{integration.summary}</p>

      {planned ? (
        <Banner title={t('integrations.notWired')}>{integration.liveBehaviour}</Banner>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {integration.fields.map((f) => (
              <div key={f.key} className={f.multiline ? 'sm:col-span-2' : ''}>
                <Label htmlFor={`${integration.id}-${f.key}`}>
                  {f.label}
                  {f.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                {f.multiline ? (
                  <Textarea
                    id={`${integration.id}-${f.key}`}
                    className="mt-1 font-mono text-xs"
                    rows={3}
                    value={values[f.key] ?? ''}
                    placeholder={f.placeholder ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                ) : (
                  <Input
                    id={`${integration.id}-${f.key}`}
                    className="mt-1"
                    type={f.secret ? 'password' : 'text'}
                    value={values[f.key] ?? ''}
                    placeholder={f.secret ? (f.set ? t('integrations.savedHint', { hint: f.hint ?? '' }) : t('integrations.notSet')) : (f.placeholder ?? '')}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
                {f.help ? <p className="mt-1 text-[11px] text-muted-foreground">{f.help}</p> : null}
              </div>
            ))}
          </div>

          {test ? (
            <p className={`mt-3 rounded-md px-3 py-2 text-sm ${test.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
              {test.detail}
              {test.latencyMs != null ? ` · ${test.latencyMs} ms` : ''}
            </p>
          ) : null}
          {error ? <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground" title={missing.length ? t('integrations.setRequired') : undefined}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={integration.enabled}
                disabled={busy !== null || missing.length > 0}
                onChange={(e) => save(e.target.checked)}
              />
              {t('integrations.useLive')}
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={runTest} disabled={busy !== null}>
                {busy === 'test' ? t('integrations.testing') : t('integrations.test')}
              </Button>
              <Button size="sm" onClick={() => save()} disabled={busy !== null}>
                {busy === 'save' ? t('integrations.saving') : t('integrations.save')}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {missing.length ? (
              <span className="text-warning">{t('integrations.needs', { fields: missing.map((f) => f.label).join(', ') })}</span>
            ) : (
              <span className="text-success">{t('integrations.allSet')}</span>
            )}
            {integration.lastCheck ? (
              <span className="text-muted-foreground">
                {t('integrations.lastChecked', { time: formatTime(integration.lastCheck.at) })} ·{' '}
                {integration.lastCheck.ok ? t('check.reachable') : t('check.failed')}
              </span>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}

export function IntegrationsPage() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api.integrations(), retry: false });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['integrations'] });
    void qc.invalidateQueries({ queryKey: ['sources'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  if (q.isError) {
    const forbidden = q.error instanceof ApiError && q.error.status === 403;
    return (
      <div>
        <PageHeader title={t('integrations.title')} description={t('integrations.description')} />
        {forbidden ? (
          <EmptyState title={t('integrations.restricted')} message={t('integrations.restrictedBody')} />
        ) : (
          <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }

  const live = q.data?.integrations.filter((i) => i.mode === 'live').length ?? 0;
  const total = q.data?.integrations.length ?? 0;

  return (
    <div>
      <PageHeader title={t('integrations.title')} description={t('integrations.description')}>
        {q.data ? <Badge variant="muted">{t('integrations.liveCount', { live, total })}</Badge> : null}
      </PageHeader>
      <div className="mb-4">
        <Banner title={t('integrations.secrets')}>{t('integrations.secretsBody')}</Banner>
      </div>
      {!q.data ? (
        <Card className="p-5">
          <LoadingRows rows={6} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.integrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
