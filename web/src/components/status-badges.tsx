import { Badge, type BadgeProps } from '@/components/ui/badge';
import { titleCase } from '@/lib/utils';
import type { IssueStatus, Severity } from '@/lib/types';

const sev: Record<Severity, BadgeProps['variant']> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'info',
  low: 'muted',
};
const st: Record<IssueStatus, BadgeProps['variant']> = {
  open: 'warning',
  in_progress: 'default',
  resolved: 'success',
};

export function SeverityBadge({ value }: { value: Severity }) {
  return <Badge variant={sev[value] ?? 'muted'}>{titleCase(value)}</Badge>;
}
export function StatusBadge({ value }: { value: IssueStatus }) {
  return <Badge variant={st[value] ?? 'muted'}>{titleCase(value)}</Badge>;
}
