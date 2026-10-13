import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime, formatMinutes } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { SeverityBadge, StatusBadge } from '@/components/status-badges';
import { ErrorState, EmptyState, LoadingRows } from '@/components/states';
import { useT } from '@/lib/i18n';

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'in_progress', 'resolved'];

function IssueDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ['issue', id], queryFn: () => api.issue(id) });
  const d = q.data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={d ? d.issue.title : t('issues.detail')}>
        {q.isLoading ? <LoadingRows rows={8} /> : null}
        {q.isError ? <ErrorState message={(q.error as Error).message} /> : null}
        {d ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <SeverityBadge value={d.issue.severity} />
              <StatusBadge value={d.issue.status} />
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">{d.issue.id}</span>
            </div>
            <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('issues.field.description')}</dt>
              <dd className="text-foreground">{d.detail.symptom}</dd>
              <dt className="text-muted-foreground">{t('issues.field.area')}</dt>
              <dd className="text-foreground">
                {d.issue.area} · {d.issue.lineName}
              </dd>
              <dt className="text-muted-foreground">{t('issues.field.model')}</dt>
              <dd className="text-foreground">{d.issue.modelId}</dd>
              {d.detail.part ? (
                <>
                  <dt className="text-muted-foreground">{t('issues.field.part')}</dt>
                  <dd className="text-foreground">
                    {d.detail.part.name} ({d.detail.part.supplier})
                  </dd>
                </>
              ) : null}
              {d.detail.checkpoint ? (
                <>
                  <dt className="text-muted-foreground">{t('issues.field.checkpoint')}</dt>
                  <dd className="text-foreground">{d.detail.checkpoint.name}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">{t('issues.field.rework')}</dt>
              <dd className="text-foreground">{d.issue.reworkMinutes ? formatMinutes(d.issue.reworkMinutes) : t('issues.noneRecorded')}</dd>
            </dl>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{t('issues.timeline')}</h3>
              <ol className="ml-1 border-l border-border">
                {d.timeline.map((e, i) => (
                  <li key={i} className="relative pb-4 pl-4">
                    <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
                    <div className="text-xs text-muted-foreground">{formatTime(e.at)}</div>
                    <div className="text-sm text-foreground">{e.label}</div>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{t('issues.sources')}</h3>
              <div className="flex flex-col gap-1.5">
                {d.sources.map((s) => (
                  <div key={s.object} className="text-sm">
                    <span className="font-semibold text-foreground">{s.label}</span> <span className="font-mono text-xs text-muted-foreground">{s.object}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function IssuesPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [severity, setSeverity] = useState(searchParams.get('severity') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [area, setArea] = useState(searchParams.get('area') ?? '');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ sort: string; dir: 'asc' | 'desc' }>({ sort: 'reportedAt', dir: 'desc' });
  const [openId, setOpenId] = useState<string | null>(searchParams.get('open'));

  // React to deep links (e.g. from Overview).
  useEffect(() => {
    const open = searchParams.get('open');
    if (open) setOpenId(open);
    const sev = searchParams.get('severity');
    if (sev) setSeverity(sev);
    const st = searchParams.get('status');
    if (st) setStatus(st);
    const query = searchParams.get('q');
    if (query) setQ(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (severity) params.set('severity', severity);
  if (status) params.set('status', status);
  if (area) params.set('area', area);
  params.set('page', String(page));
  params.set('sort', sort.sort);
  params.set('dir', sort.dir);

  const query = useQuery({
    queryKey: ['issues', params.toString()],
    queryFn: () => api.issues(params.toString()),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  const onSort = (col: string) => {
    setSort((p) => ({ sort: col, dir: p.sort === col && p.dir === 'desc' ? 'asc' : 'desc' }));
    setPage(1);
  };
  const SortHead = ({ col, children }: { col: string; children: React.ReactNode }) => (
    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => onSort(col)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {data?.sort === col ? data.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" /> : null}
      </span>
    </TableHead>
  );

  const anyFilter = q || severity || status || area;
  const reset = () => {
    setQ('');
    setSeverity('');
    setStatus('');
    setArea('');
    setPage(1);
    setSearchParams({});
  };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const summary = data?.summary;
  const cells = [
    { label: t('issues.total'), value: summary?.total },
    { label: t('issues.critical'), value: summary?.critical },
    { label: t('issues.open'), value: summary?.open },
    { label: t('issues.resolved'), value: summary?.resolved },
  ];

  return (
    <div>
      <PageHeader title={t('issues.title')} description={t('issues.description')} />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cells.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="text-sm font-medium text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{c.value ?? '—'}</div>
          </Card>
        ))}
      </div>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="q">{t('issues.search')}</Label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="q"
              className="pl-8"
              placeholder={t('issues.searchPlaceholder')}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="w-[150px]">
          <Label htmlFor="sev">{t('issues.severity')}</Label>
          <Select
            id="sev"
            className="mt-1"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`severity.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[150px]">
          <Label htmlFor="st">{t('issues.status')}</Label>
          <Select
            id="st"
            className="mt-1"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[170px]">
          <Label htmlFor="area">{t('issues.area')}</Label>
          <Select
            id="area"
            className="mt-1"
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {(data?.areas ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        {anyFilter ? (
          <Button variant="secondary" size="sm" className="ml-auto" onClick={reset}>
            <X /> {t('issues.reset')}
          </Button>
        ) : null}
      </Card>

      {query.isError ? (
        <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
      ) : query.isLoading && !data ? (
        <Card className="p-5">
          <LoadingRows rows={8} />
        </Card>
      ) : data && data.total === 0 ? (
        <EmptyState
          title={t('issues.noneTitle')}
          message={t('issues.noneBody')}
          action={
            anyFilter ? (
              <Button variant="secondary" size="sm" onClick={reset}>
                {t('issues.reset')}
              </Button>
            ) : undefined
          }
        />
      ) : data ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('issues.col.issue')}</TableHead>
                <SortHead col="severity">{t('issues.severity')}</SortHead>
                <SortHead col="area">{t('issues.area')}</SortHead>
                <SortHead col="reportedAt">{t('issues.col.reported')}</SortHead>
                <SortHead col="status">{t('issues.status')}</SortHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((issue) => (
                <TableRow key={issue.id} className="cursor-pointer" onClick={() => setOpenId(issue.id)}>
                  <TableCell>
                    <div className="font-semibold text-foreground">{issue.title}</div>
                    <div className="text-xs text-muted-foreground">{issue.id}</div>
                  </TableCell>
                  <TableCell>
                    <SeverityBadge value={issue.severity} />
                  </TableCell>
                  <TableCell>{issue.area}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {issue.date} {formatTime(issue.reportedAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={issue.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <span>
              {t('issues.range', { from: (data.page - 1) * data.pageSize + 1, to: Math.min(data.page * data.pageSize, data.total), total: data.total })}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {t('common.previous')}
              </Button>
              <span>{t('common.page', { page: data.page, total: totalPages })}</span>
              <Button variant="secondary" size="sm" disabled={data.page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                {t('common.next')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {openId ? (
        <IssueDrawer
          id={openId}
          onClose={() => {
            setOpenId(null);
            searchParams.delete('open');
            setSearchParams(searchParams, { replace: true });
          }}
        />
      ) : null}
    </div>
  );
}
