import { MessageSquare, AlertTriangle, BarChart3, FileText, Plug, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';

const GUIDE = [
  { icon: MessageSquare, title: 'Ask Jervis', body: 'Type a production question in plain language. Jervis chooses which approved systems to read, retrieves the data, and answers with the sources named.' },
  { icon: AlertTriangle, title: 'Production Issues', body: 'Search, filter and sort every recorded issue. Click a row for the detail drawer with the timeline, related findings and sources.' },
  { icon: BarChart3, title: 'Production Analytics', body: 'Trends and breakdowns by severity, area and error code over a date range. Every series is a real aggregate.' },
  { icon: FileText, title: 'Shift Reports', body: 'Generate a shift or full-day summary. Figures are retrieved facts; the narrative is marked deterministic or AI-generated.' },
  { icon: Plug, title: 'Data Sources & Integrations', body: 'See what is connected and in which mode. Managers configure credentials and test connections. Nothing reads live data until enabled.' },
  { icon: ShieldCheck, title: 'Audit Logs', body: 'Managers review every question asked and every administrative change, filtered by user, action and outcome.' },
];

export function HelpPage() {
  return (
    <div>
      <PageHeader title="Help & Documentation" description="How Jervis works and how to get answers quickly." />
      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-base font-semibold text-foreground">What Jervis is</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Jervis is a production intelligence assistant. It sits on top of the systems a plant already runs and gives you one
          consolidated answer in plain language, with every figure attributed to the system it came from. It does not replace
          those systems; it reads from them and points you back to them.
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {GUIDE.map((g) => (
          <Card key={g.title} className="p-5">
            <div className="mb-1.5 flex items-center gap-2.5">
              <g.icon className="h-[18px] w-[18px] text-primary" />
              <h3 className="text-base font-semibold text-foreground">{g.title}</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{g.body}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-5">
        <h2 className="mb-2 text-base font-semibold text-foreground">Demo limitations</h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>All data is synthetic and generated from a fixed seed. No Mercedes data is used.</li>
          <li>Connectors run in demo mode until real credentials are added on the Integrations page.</li>
          <li>The assistant never claims a live source unless that integration has been configured and enabled.</li>
        </ul>
      </Card>
    </div>
  );
}
