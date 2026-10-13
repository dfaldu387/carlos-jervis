import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ArrowUpRight, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatTime } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { TrendArea } from '@/components/charts';
import { ErrorState, LoadingRows } from '@/components/states';
import { JervisCore } from '@/components/jervis-core';

const toneBadge: Record<string, BadgeProps['variant']> = {
  critical: 'destructive',
  serious: 'warning',
  warning: 'warning',
  info: 'info',
  good: 'success',
};

function Gauge({ label, value, detail, goodHigh }: { label: string; value: number; detail?: string; goodHigh: boolean }) {
  const pct = Math.round(value * 100);
  const good = goodHigh ? value >= 0.9 : value <= 0.15;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className={cn('h-full rounded-full', good ? 'bg-success' : 'bg-warning')} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

export function CommandPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['command-center'], queryFn: () => api.commandCenter(), refetchInterval: 60_000 });
  const ask = (question: string) => navigate(`/ask?q=${encodeURIComponent(question)}`);
  const d = q.data;

  if (q.isError) {
    return (
      <div>
        <PageHeader title="Command Center" description="Live production state at a glance." />
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Command Center" description="Live production state, with the assistant at the centre.">
        {d ? (
          <>
            <Badge variant={d.status.overall === 'optimal' ? 'success' : 'warning'}>
              {d.status.overall === 'optimal' ? 'All nominal' : 'Attention'}
            </Badge>
            <span className="text-xs text-muted-foreground">Updated {formatTime(d.status.generatedAt)}</span>
          </>
        ) : null}
      </PageHeader>

      {!d ? (
        <Card className="p-5"><LoadingRows rows={8} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Core status */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Core overview</h2>
            <div className="flex flex-col gap-2.5">
              {d.core.map((c) => (
                <div key={c.id} className="flex items-center gap-2.5">
                  <span className={cn('h-2 w-2 flex-none rounded-full', c.state === 'online' ? 'bg-success' : 'bg-warning')} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{c.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Central Jervis voice core */}
          <Card className="p-5">
            <JervisCore />
          </Card>

          {/* Live feed */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Live intelligence feed</h2>
            </div>
            <div className="flex flex-col gap-2">
              {d.feed.length === 0 ? <p className="text-sm text-muted-foreground">Quiet right now.</p> : null}
              {d.feed.map((f) => (
                <button key={f.id} type="button" onClick={() => ask(f.question)} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-secondary/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={toneBadge[f.tone] ?? 'muted'}>{f.tag}</Badge>
                      <span className="truncate text-sm font-semibold text-foreground">{f.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{f.detail}</div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 flex-none text-muted-foreground" />
                </button>
              ))}
            </div>
          </Card>

          {/* Connected systems */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Connected systems</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {d.agents.map((a) => (
                <div key={a.id} className="rounded-lg border border-border px-3 py-2">
                  <div className="text-sm font-medium text-foreground">{a.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.state === 'live' ? 'bg-success' : a.state === 'planned' ? 'bg-muted-foreground' : 'bg-warning')} />
                    <span className="text-muted-foreground">{a.state === 'live' ? 'Connected' : a.state === 'planned' ? 'Planned' : 'Demo'}</span>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => navigate('/sources')}>
              Details <ChevronRight />
            </Button>
          </Card>

          {/* Shift timeline */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Shift timeline</h2>
            <div className="flex flex-col gap-2">
              {d.timeline.map((s) => (
                <button key={s.shiftId} type="button" onClick={() => ask(s.question)} className={cn('flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-secondary/50', s.state === 'running' ? 'border-primary/40 bg-primary/5' : 'border-border')}>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{s.name}{s.state === 'running' ? ' · running' : ''}</div>
                    <div className="text-xs text-muted-foreground">{s.window} · {s.vehicles} vehicles</div>
                  </div>
                  <span className="text-lg font-bold tabular-nums text-foreground">{s.issues}</span>
                </button>
              ))}
            </div>
          </Card>

          {/* Quick commands */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Quick commands</h2>
            <div className="flex flex-col gap-2">
              {d.quickCommands.map((c) => (
                <button key={c.label} type="button" onClick={() => ask(c.question)} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-secondary/50">
                  <Play className="h-3.5 w-3.5 text-primary" /> {c.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Production monitor */}
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Production monitor</h2>
            <div className="flex flex-col gap-4">
              {d.gauges.map((g) => (
                <Gauge key={g.key} label={g.label} value={g.value} detail={g.detail} goodHigh={g.goodHigh} />
              ))}
            </div>
          </Card>

          {/* Issue trend */}
          <Card className="p-5 lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Issue trend</h2>
            <TrendArea data={d.trend.points} height={180} />
          </Card>
        </div>
      )}
    </div>
  );
}
