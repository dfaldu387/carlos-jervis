import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowLeft, LayoutGrid, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { CategoryBars, TrendArea } from '@/components/charts';
import { useI18n } from '@/lib/i18n';
import type { CategoryWidgetData, DashboardWidget, KpiWidgetData, SeriesWidgetData } from '@/lib/types';

const PIE_COLORS = ['hsl(var(--primary))', 'hsl(var(--warning))', 'hsl(var(--destructive))', 'hsl(var(--success))', 'hsl(var(--muted-foreground))'];

const IDEAS = ['dash.idea.1', 'dash.idea.2', 'dash.idea.3'];

function Widget({ w }: { w: DashboardWidget }) {
  const { t, locale } = useI18n();
  // A chart with no rows must not render as a blank box; KPI tiles always carry a number.
  const chartEmpty = w.type !== 'kpi' && (!Array.isArray(w.data) || (w.data as unknown[]).length === 0);
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">{w.title}</div>
        <span className="truncate text-[11px] text-muted-foreground">{w.source.label}</span>
      </div>
      {chartEmpty ? <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('dash.noData')}</div> : null}
      {!chartEmpty && w.type === 'kpi' ? (
        <div>
          <div className="text-3xl font-bold tabular-nums text-foreground">
            {(w.data as KpiWidgetData).value.toLocaleString(locale)}
            {(w.data as KpiWidgetData).unit ? <span className="ml-1 text-base font-medium text-muted-foreground">{(w.data as KpiWidgetData).unit}</span> : null}
          </div>
          {(w.data as KpiWidgetData).delta != null ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {t('dash.delta', { delta: `${(w.data as KpiWidgetData).delta! > 0 ? '+' : ''}${(w.data as KpiWidgetData).delta}` })}
            </div>
          ) : null}
        </div>
      ) : null}
      {!chartEmpty && w.type === 'bar' ? <CategoryBars data={(w.data as CategoryWidgetData).map((d) => ({ label: d.name, value: d.value }))} /> : null}
      {!chartEmpty && w.type === 'line' ? <TrendArea data={(w.data as SeriesWidgetData).map((d) => ({ date: d.date, count: d.value }))} height={200} /> : null}
      {!chartEmpty && w.type === 'pie' ? (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={w.data as CategoryWidgetData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2} stroke="none">
                {(w.data as CategoryWidgetData).map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: 'hsl(var(--foreground))' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="-mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {(w.data as CategoryWidgetData).map((d, i) => (
              <li key={d.name} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} /> {d.name} · {d.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

export function DashboardsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t, locale } = useI18n();
  const list = useQuery({ queryKey: ['dashboards'], queryFn: () => api.dashboards(), select: (d) => d.items });
  const [question, setQuestion] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (q: string) => api.createDashboard({ question: q }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['dashboards'] });
      navigate(`/dashboards/${r.item.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDashboard(id),
    onSuccess: () => {
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  return (
    <div>
      <PageHeader title={t('dash.title')} description={t('dash.subtitle')} />

      <Card className="mb-5 p-5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) create.mutate(question.trim());
          }}
        >
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('dash.placeholder')} className="flex-1" />
          <Button type="submit" disabled={!question.trim() || create.isPending}>
            <Sparkles /> {create.isPending ? t('dash.building') : t('dash.create')}
          </Button>
        </form>
        {create.isError ? <p className="mt-2 text-sm text-destructive">{(create.error as Error).message}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setQuestion(t(idea))}
              className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(idea)}
            </button>
          ))}
        </div>
      </Card>

      {list.isLoading ? <LoadingRows rows={4} /> : null}
      {list.isError ? <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <EmptyState title={t('dash.none')} message={t('dash.noneDetail')} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((d) => (
          <Card key={d.id} className="flex flex-col p-5">
            <Link to={`/dashboards/${d.id}`} className="flex items-start gap-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary/10 text-primary">
                <LayoutGrid className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{d.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{d.question}</span>
              </span>
            </Link>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t('dash.widgets', { count: d.widgetCount })} · {new Date(d.createdAt).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
              </span>
              {pendingDelete === d.id ? (
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => remove.mutate(d.id)} disabled={remove.isPending}>
                    {t('dash.delete')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setPendingDelete(null)}>
                    {t('dash.keep')}
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setPendingDelete(d.id)}
                  aria-label={t('dash.deleteLabel')}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function DashboardViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const t = useI18n().t;
  const dash = useQuery({ queryKey: ['dashboards', id], queryFn: () => api.dashboardById(id!), enabled: Boolean(id), select: (d) => d.item });

  return (
    <div>
      <PageHeader
        title={dash.data?.title ?? t('dash.one')}
        description={dash.data ? t('dash.builtFrom', { period: dash.data.period.label, question: dash.data.question }) : undefined}
      >
        <Button variant="secondary" size="sm" onClick={() => navigate('/dashboards')}>
          <ArrowLeft /> {t('dash.all')}
        </Button>
        <Button size="sm" onClick={() => navigate(`/?q=${encodeURIComponent(dash.data?.question ?? '')}`)} disabled={!dash.data}>
          <Plus /> {t('dash.followUp')}
        </Button>
      </PageHeader>
      {dash.isLoading ? <LoadingRows rows={6} /> : null}
      {dash.isError ? <ErrorState message={(dash.error as Error).message} onRetry={() => void dash.refetch()} /> : null}
      {dash.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dash.data.widgets.map((w) => (
            <div key={w.id} className={w.type === 'kpi' ? '' : 'sm:col-span-2 lg:col-span-1'}>
              <Widget w={w} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
