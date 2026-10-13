import { MessageSquare, AlertTriangle, BarChart3, FileText, Plug, ShieldCheck, CalendarDays, Mail, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { useT } from '@/lib/i18n';

const GUIDE = [
  { icon: MessageSquare, key: 'ask' },
  { icon: CalendarDays, key: 'today' },
  { icon: Mail, key: 'inbox' },
  { icon: LayoutGrid, key: 'dashboards' },
  { icon: AlertTriangle, key: 'issues' },
  { icon: BarChart3, key: 'analytics' },
  { icon: FileText, key: 'reports' },
  { icon: Plug, key: 'integrations' },
  { icon: ShieldCheck, key: 'audit' },
];

export function HelpPage() {
  const t = useT();
  return (
    <div>
      <PageHeader title={t('help.title')} description={t('help.subtitle')} />
      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-base font-semibold text-foreground">{t('help.what')}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t('help.whatBody')}</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {GUIDE.map((g) => (
          <Card key={g.key} className="p-5">
            <div className="mb-1.5 flex items-center gap-2.5">
              <g.icon className="h-[18px] w-[18px] text-primary" />
              <h3 className="text-base font-semibold text-foreground">{t(`help.${g.key}`)}</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{t(`help.${g.key}.body`)}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-5">
        <h2 className="mb-2 text-base font-semibold text-foreground">{t('help.limits')}</h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>{t('help.limit.1')}</li>
          <li>{t('help.limit.2')}</li>
          <li>{t('help.limit.3')}</li>
        </ul>
      </Card>
    </div>
  );
}
