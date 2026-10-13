import { Badge, type BadgeProps } from '@/components/ui/badge';
import { titleCase } from '@/lib/utils';
import { useT } from '@/lib/i18n';
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
  const t = useT();
  return <Badge variant={sev[value] ?? 'muted'}>{sev[value] ? t(`severity.${value}`) : titleCase(value)}</Badge>;
}
export function StatusBadge({ value }: { value: IssueStatus }) {
  const t = useT();
  return <Badge variant={st[value] ?? 'muted'}>{st[value] ? t(`status.${value}`) : titleCase(value)}</Badge>;
}
