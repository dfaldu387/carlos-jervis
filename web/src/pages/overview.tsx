import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ArrowDownRight, MessageSquare, ChevronRight, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime, titleCase } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Banner, ErrorState, LoadingRows } from '@/components/states';
import { SeverityBadge, StatusBadge } from '@/components/status-badges';
import { TrendArea, CategoryBars } from '@/components/charts';
import type { Kpi } from '@/lib/types';

function parseTo(to?: string): { path: string; search: string } {
  if (!to) return { path: '/', search: '' };
  const [p, q] = to.split('?');
  const map: Record<string, string> = { issues: '/issues', analytics: '/analytics', sources: '/sources' };
  return { path: map[p] ?? `/${p}`, search: q ? `?${q}` : '' };
}

function KpiCard({ id, kpi, onGo }: { id: string; kpi: Kpi; onGo: (to?: string) => void }) {
  void id;
  const delta = kpi.delta;
  return (
    <Card
      className="cursor-pointer p-5 transition-shadow hover:shadow-md"
      onClick={() => onGo(kpi.to)}
      role="button"
    >
      <div className="text-sm font-medium text-muted-foreground">{kpi.label}</div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-foreground">
        {kpi.value}
        {kpi.total != null ? <span className="text-xl text-muted-foreground"> / {kpi.total}</span> : null}
      </div>
      {delta != null && kpi.previous != null ? (
        <div
          className={`mt-1.5 inline-flex items-center gap-1 text-xs font-semibold ${
            delta > 0 ? 'text-destructive' : delta < 0 ? 'text-success' : 'text-muted-foreground'
          }`}
        >
          {delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : delta < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}
          {delta === 0 ? 'No change' : `${delta > 0 ? '+' : ''}${delta} vs previous`}
        </div>
      ) : (
        <div className="mt-1.5 text-xs text-muted-foreground">{kpi.help}</div>
      )}
    </Card>
  );
}

export function OverviewPage() {
  const { user } = useNavigateUser();
  const navigate = useNavigate();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard(14) });
  const attention = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.issues('status=open&sort=severity&dir=desc&pageSize=4'),
    select: (d) => d.items,
  });

  const go = (to?: string) => {
    const { path, search } = parseTo(to);
    navigate(`${path}${search}`);
  };

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();

  if (dash.isError) {
    return <ErrorState message={(dash.error as Error).message} onRetry={() => dash.refetch()} />;
  }

  const d = dash.data;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {greeting}, {user?.name?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Here is your production operations overview.</p>
          {d ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Period: <span className="font-medium text-foreground">Last {d.period.days} days</span> · Updated{' '}
              <span className="font-medium text-foreground">{formatTime(d.generatedAt)}</span>
            </p>
          ) : null}
        </div>
        <Button onClick={() => navigate('/ask')}>
          <MessageSquare /> Ask a question
        </Button>
      </div>

      <div className="mb-5">
        <Banner tone="warning" title="Demo mode">
          Showing synthetic demo data{d ? ` through ${d.referenceDate}` : ''}. No live enterprise systems are connected.
        </Banner>
      </div>

      {!d ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="p-5">
              <LoadingRows rows={2} />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Object.entries(d.kpis).map(([id, kpi]) => (
            <KpiCard key={id} id={id} kpi={kpi} onGo={go} />
          ))}
        </div>
      )}

      {/* Attention required */}
      <Card className="mt-5 p-5">
        <h2 className="mb-1 text-base font-semibold text-foreground">Attention required</h2>
        <p className="mb-4 text-sm text-muted-foreground">Problems worth acting on today, most urgent first.</p>
        {attention.isLoading ? (
          <LoadingRows rows={3} />
        ) : attention.data && attention.data.length > 0 ? (
          <div className="flex flex-col gap-2">
            {attention.data.map((issue) => (
              <div key={issue.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <SeverityBadge value={issue.severity} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{issue.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {issue.area} · reported {formatTime(issue.reportedAt)} · {titleCase(issue.status)}
                    </div>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => navigate(`/issues?open=${issue.id}`)}>
                  Investigate
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-7 w-7 text-success" />
            <div className="text-sm font-medium text-foreground">Nothing needs attention right now</div>
            <p className="max-w-md text-sm text-muted-foreground">No open issues are outstanding. This list fills itself in when something changes.</p>
          </div>
        )}
      </Card>

      {d ? (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h2 className="text-base font-semibold text-foreground">Production activity</h2>
              <p className="mb-3 text-xs text-muted-foreground">Issue events per day over the last {d.period.days} days</p>
              <TrendArea data={d.activityTrend} />
            </Card>
            <Card className="p-5">
              <h2 className="text-base font-semibold text-foreground">Issue breakdown</h2>
              <p className="mb-2 text-xs text-muted-foreground">By severity</p>
              <CategoryBars data={d.issueBreakdown.bySeverity.map((b) => ({ label: b.label, value: b.count }))} />
            </Card>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">Recent production issues</h2>
                <Button variant="secondary" size="sm" onClick={() => navigate('/issues')}>
                  View all <ChevronRight />
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {d.recentIssues.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => navigate(`/issues?open=${issue.id}`)}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5 text-left transition-colors hover:bg-secondary/50"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{issue.title}</div>
                      <div className="text-xs text-muted-foreground">{issue.area} · {formatTime(issue.reportedAt)}</div>
                    </div>
                    <div className="flex flex-none gap-2">
                      <SeverityBadge value={issue.severity} />
                      <StatusBadge value={issue.status} />
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-base font-semibold text-foreground">Data source health</h2>
              <div className="flex flex-col gap-2.5">
                {d.sourceHealth.map((s) => (
                  <div key={s.id} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{s.name}</span>
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        s.mode === 'live' ? 'text-success' : s.mode === 'planned' ? 'text-muted-foreground' : 'text-warning'
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {s.mode === 'live' ? 'Connected' : s.mode === 'planned' ? 'Planned' : 'Demo mode'}
                    </span>
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="sm" className="mt-4 w-full" onClick={() => navigate('/sources')}>
                Manage sources <ChevronRight />
              </Button>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

// Small helper so the component reads the auth user without importing hook at top-level twice.
function useNavigateUser() {
  const { user } = useAuth();
  return { user };
}
