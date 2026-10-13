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

const PAGE_SIZE = 15;

export function AuditPage() {
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
      detail: `${e.intent ?? 'n/a'} · ${e.sources.map((s) => s.split(':')[0]).join(', ') || 'no sources'}`,
    }));
    const events = d.events.map((e) => ({ id: e.id, at: e.at, role: e.role, user: e.userId, action: e.action, resource: e.resource, outcome: e.outcome, detail: e.detail ?? '' }));
    return [...queries, ...events].sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [q.data]);

  if (q.isError) {
    const forbidden = q.error instanceof ApiError && q.error.status === 403;
    return (
      <div>
        <PageHeader title="Audit Logs" description="Review recorded access and administrative changes." />
        {forbidden ? (
          <EmptyState title="You do not have access to the audit log" message="Audit records are restricted to the Production manager role. Sign in with a manager account to view them." />
        ) : (
          <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }

  const users = [...new Set(rows.map((r) => r.user))];
  const actions = [...new Set(rows.map((r) => r.action))];
  const filtered = rows.filter(
    (r) => (!filters.user || r.user === filters.user) && (!filters.action || r.action === filters.action) && (!filters.outcome || r.outcome === filters.outcome),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const summary = { total: rows.length, ok: rows.filter((r) => r.outcome === 'ok').length, failed: rows.filter((r) => r.outcome === 'failed').length, admin: q.data?.events.length ?? 0 };

  return (
    <div>
      <PageHeader title="Audit Logs" description="Review recorded access and administrative changes." />
      {!q.data ? (
        <Card className="p-5"><LoadingRows rows={8} /></Card>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-4">
            {[['Recorded events', summary.total], ['Successful', summary.ok], ['Failed', summary.failed], ['Admin changes', summary.admin]].map(([l, v]) => (
              <Card key={l} className="p-4">
                <div className="text-sm font-medium text-muted-foreground">{l}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{v}</div>
              </Card>
            ))}
          </div>

          <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
            <div className="w-[180px]">
              <Label>User</Label>
              <Select className="mt-1" value={filters.user} onChange={(e) => { setFilters((f) => ({ ...f, user: e.target.value })); setPage(1); }}>
                <option value="">All</option>
                {users.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
            <div className="w-[180px]">
              <Label>Action</Label>
              <Select className="mt-1" value={filters.action} onChange={(e) => { setFilters((f) => ({ ...f, action: e.target.value })); setPage(1); }}>
                <option value="">All</option>
                {actions.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            </div>
            <div className="w-[150px]">
              <Label>Outcome</Label>
              <Select className="mt-1" value={filters.outcome} onChange={(e) => { setFilters((f) => ({ ...f, outcome: e.target.value })); setPage(1); }}>
                <option value="">All</option>
                <option value="ok">Ok</option>
                <option value="failed">Failed</option>
              </Select>
            </div>
          </Card>

          {filtered.length === 0 ? (
            <EmptyState title="No audit records match" message="Adjust the filters to see more events." />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{r.at.slice(0, 10)} {formatTime(r.at)}</TableCell>
                      <TableCell>{titleCase(r.role)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.action}</TableCell>
                      <TableCell className="max-w-[260px] truncate">{r.resource}</TableCell>
                      <TableCell><Badge variant={r.outcome === 'ok' ? 'success' : 'destructive'}>{r.outcome}</Badge></TableCell>
                      <TableCell className="max-w-[240px] truncate text-muted-foreground">{r.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <span>{filtered.length} records</span>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span>Page {page} of {totalPages}</span>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
