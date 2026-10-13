import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime, titleCase } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { ErrorState, LoadingRows } from '@/components/states';
import type { ConnectorMode } from '@/lib/types';

const modeBadge: Record<ConnectorMode, { variant: BadgeProps['variant']; label: string }> = {
  live: { variant: 'success', label: 'Connected' },
  mock: { variant: 'warning', label: 'Demo mode' },
  planned: { variant: 'muted', label: 'Planned' },
};

export function SourcesPage() {
  const q = useQuery({ queryKey: ['sources'], queryFn: () => api.sources() });

  return (
    <div>
      <PageHeader title="Data Sources" description="Understand which systems are connected, available, or unavailable." />
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Card className="p-5"><LoadingRows rows={6} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.connectors.map((c) => {
            const m = modeBadge[c.mode];
            return (
              <Card key={c.id} className="p-5">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="text-base font-semibold text-foreground">{c.name}</div>
                  <Badge variant={m.variant}>{m.label}</Badge>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">{c.purpose}</p>
                <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Access</dt>
                  <dd className="text-foreground">{c.access}</dd>
                  {c.capabilities.length ? (<><dt className="text-muted-foreground">Capabilities</dt><dd className="text-foreground">{c.capabilities.join(', ')}</dd></>) : null}
                  {c.lastCheck ? (<><dt className="text-muted-foreground">Last check</dt><dd className="text-foreground">{c.lastCheck.at.slice(0, 16).replace('T', ' ')} · {c.lastCheck.ok ? 'reachable' : 'failed'}</dd></>) : null}
                  <dt className="text-muted-foreground">Security</dt>
                  <dd className="text-foreground">{c.securityNote}</dd>
                </dl>
                {c.openUrl ? (
                  <a href={c.openUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Open {c.name} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { titleCase };
