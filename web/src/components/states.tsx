import * as React from 'react';
import { Inbox, AlertCircle, Info, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/lib/i18n';

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <Inbox className="h-7 w-7 text-muted-foreground" />
      <div className="text-base font-semibold text-foreground">{title}</div>
      {message ? <p className="max-w-md text-sm text-muted-foreground">{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/40 bg-card px-6 py-12 text-center">
      <AlertCircle className="h-7 w-7 text-destructive" />
      <div className="text-base font-semibold text-foreground">{t('common.error')}</div>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCw /> {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function Banner({ tone = 'info', title, children }: { tone?: 'info' | 'warning'; title: string; children?: React.ReactNode }) {
  const styles = tone === 'warning' ? 'border-warning/30 bg-warning/10 text-foreground' : 'border-primary/25 bg-primary/5 text-foreground';
  const Icon = tone === 'warning' ? AlertCircle : Info;
  const iconColor = tone === 'warning' ? 'text-warning' : 'text-primary';
  return (
    <div className={cn('flex gap-3 rounded-lg border p-4', styles)}>
      <Icon className={cn('mt-0.5 h-5 w-5 flex-none', iconColor)} />
      <div className="text-sm">
        <div className="font-semibold">{title}</div>
        {children ? <div className="mt-0.5 text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
