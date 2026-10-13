import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { formatTime, titleCase } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { useT } from '@/lib/i18n';

const PAGE_SIZE = 15;
const ROLE_KEYS: Record<string, string> = { viewer: 'role.viewer', engineer: 'role.engineer', manager: 'role.manager', anonymous: 'role.anonymous' };
const OUTCOME_KEYS: Record<string, string> = { ok: 'audit.outcome.ok', failed: 'audit.outcome.failed' };

export function AuditPage() {
  const t = useT();
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.audit(200), retry: false });
  const [filters, setFilters] = useState({ user: '', action: '', outcome: '' });
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const d = q.data;
    if (!d) return [];
    const queries = d.entries.map((e) => ({
      id: e.id,
      at: e.at,
      role: e.role,
      user: e.userId,
      action: 'query.ask',
      resource: e.question,
      outcome: 'ok',
      detail: `${e.intent ?? t('audit.na')} · ${e.sources.map((s) => s.split(':')[0]).join(', ') || t('audit.noSources')}`,
    }));
    const events = d.events.map((e) => ({
      id: e.id,
      at: e.at,
      role: e.role,
      user: e.userId,
      action: e.action,
      resource: e.resource,
      outcome: e.outcome,
      detail: e.detail ?? '',
    }));
    return [...queries, ...events].sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [q.data, t]);

  if (q.isError) {
    const forbidden = q.error instanceof ApiError && q.error.status === 403;
    return (
      <div>
        <PageHeader title={t('audit.title')} description={t('audit.description')} />
        {forbidden ? (
          <EmptyState title={t('audit.restricted')} message={t('audit.restrictedBody')} />
        ) : (
          <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }

  const users = [...new Set(rows.map((r) => r.user))];
  const actions = [...new Set(rows.map((r) => r.action))];
  const filtered = rows.filter(
    (r) =>
      (!filters.user || r.user === filters.user) && (!filters.action || r.action === filters.action) && (!filters.outcome || r.outcome === filters.outcome),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.outcome === 'ok').length,
    failed: rows.filter((r) => r.outcome === 'failed').length,
    admin: q.data?.events.length ?? 0,
  };

  return (
    <div>
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      {!q.data ? (
        <Card className="p-5">
          <LoadingRows rows={8} />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-4">
            {[
              [t('audit.recorded'), summary.total],
              [t('audit.successful'), summary.ok],
              [t('audit.failed'), summary.failed],
              [t('audit.admin'), summary.admin],
            ].map(([l, v]) => (
              <Card key={l} className="p-4">
                <div className="text-sm font-medium text-muted-foreground">{l}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{v}</div>
              </Card>
            ))}
          </div>

          <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
            <div className="w-[180px]">
              <Label>{t('audit.user')}</Label>
              <Select
                className="mt-1"
                value={filters.user}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, user: e.target.value }));
                  setPage(1);
                }}
              >
                <option value="">{t('common.all')}</option>
                {users.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-[180px]">
              <Label>{t('audit.action')}</Label>
              <Select
                className="mt-1"
                value={filters.action}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, action: e.target.value }));
                  setPage(1);
                }}
              >
                <option value="">{t('common.all')}</option>
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-[150px]">
              <Label>{t('audit.outcome')}</Label>
              <Select
                className="mt-1"
                value={filters.outcome}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, outcome: e.target.value }));
                  setPage(1);
                }}
              >
                <option value="">{t('common.all')}</option>
                <option value="ok">{t('audit.filter.ok')}</option>
                <option value="failed">{t('audit.filter.failed')}</option>
              </Select>
            </div>
          </Card>

          {filtered.length === 0 ? (
            <EmptyState title={t('audit.noMatch')} message={t('audit.noMatchBody')} />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('audit.col.time')}</TableHead>
                    <TableHead>{t('audit.user')}</TableHead>
                    <TableHead>{t('audit.action')}</TableHead>
                    <TableHead>{t('audit.col.resource')}</TableHead>
                    <TableHead>{t('audit.outcome')}</TableHead>
                    <TableHead>{t('audit.col.details')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {r.at.slice(0, 10)} {formatTime(r.at)}
                      </TableCell>
                      <TableCell>{ROLE_KEYS[r.role] ? t(ROLE_KEYS[r.role]) : titleCase(r.role)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.action}</TableCell>
                      <TableCell className="max-w-[260px] truncate">{r.resource}</TableCell>
                      <TableCell>
                        <Badge variant={r.outcome === 'ok' ? 'success' : 'destructive'}>
                          {OUTCOME_KEYS[r.outcome] ? t(OUTCOME_KEYS[r.outcome]) : r.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-muted-foreground">{r.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <span>{t('audit.records', { count: filtered.length })}</span>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    {t('common.previous')}
                  </Button>
                  <span>{t('common.page', { page, total: totalPages })}</span>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    {t('common.next')}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
