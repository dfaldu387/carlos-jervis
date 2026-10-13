import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { TrendArea, CategoryBars } from '@/components/charts';
import { ErrorState, LoadingRows } from '@/components/states';

const RANGES = [7, 14, 28];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

export function AnalyticsPage() {
  const [days, setDays] = useState(14);
  const [severity, setSeverity] = useState('');
  const [area, setArea] = useState('');
  const areas = useQuery({ queryKey: ['issue-areas'], queryFn: () => api.issues('pageSize=5'), select: (d) => d.areas });

  const params = new URLSearchParams({ days: String(days) });
  if (severity) params.set('severity', severity);
  if (area) params.set('area', area);
  const q = useQuery({ queryKey: ['analytics', params.toString()], queryFn: () => api.analytics(params.toString()) });
  const d = q.data;

  return (
    <div>
      <PageHeader title="Production Analytics" description="Explore production events and operational trends." />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <Label>Date range</Label>
          <div className="mt-1 inline-flex overflow-hidden rounded-md border border-input">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDays(r)}
                className={`px-3 py-1.5 text-sm ${days === r ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
              >
                {r} days
              </button>
            ))}
          </div>
        </div>
        <div className="w-[150px]">
          <Label htmlFor="sev">Severity</Label>
          <Select id="sev" className="mt-1" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </Select>
        </div>
        <div className="w-[170px]">
          <Label htmlFor="area">Production area</Label>
          <Select id="area" className="mt-1" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All</option>
            {(areas.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
      </Card>

      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : !d ? (
        <Card className="p-5"><LoadingRows rows={8} /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="text-base font-semibold text-foreground">Issue trends</h2>
            <p className="mb-2 text-xs text-muted-foreground">Issue events per day, {d.period.from} to {d.period.to}</p>
            <TrendArea data={d.trend} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-2 text-base font-semibold text-foreground">Issues by severity</h2>
              <CategoryBars data={d.bySeverity.map((b) => ({ label: b.label, value: b.count }))} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-2 text-base font-semibold text-foreground">Issues by production area</h2>
              <CategoryBars data={d.byArea.map((b) => ({ label: b.label, value: b.count }))} color="hsl(var(--info))" />
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-2 text-base font-semibold text-foreground">Top error codes</h2>
              <CategoryBars data={d.byErrorCode.map((b) => ({ label: b.label.slice(0, 22), value: b.count }))} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-2 text-base font-semibold text-foreground">Event timeline</h2>
              {d.events.length ? (
                <ol className="ml-1 border-l border-border">
                  {d.events.slice(0, 8).map((e, i) => (
                    <li key={i} className="relative pb-3 pl-4">
                      <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
                      <div className="text-xs text-muted-foreground">{e.at.slice(0, 10)} {formatTime(e.at)}</div>
                      <div className="text-sm text-foreground">{e.label} · {e.durationMinutes} min</div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No downtime events for this range.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
