import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Sun, Moon, Monitor } from 'lucide-react';
import { api } from '@/lib/api';
import { applyTheme, getStoredTheme, type ThemePref } from '@/lib/theme';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/states';

const TABS = ['Appearance', 'AI configuration', 'Data sources', 'System'] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const navigate = useNavigate();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  const [tab, setTab] = useState<Tab>('Appearance');
  const [theme, setTheme] = useState<ThemePref>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const h = health.data;

  return (
    <div>
      <PageHeader title="Settings" description="Preferences, AI configuration, and system information." />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-semibold ${tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Appearance' ? (
        <Card className="max-w-xl p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">Theme</h2>
          <div className="inline-flex overflow-hidden rounded-md border border-input">
            {([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([value, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={`flex items-center gap-2 px-3.5 py-2 text-sm ${theme === value ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
              >
                <Icon className="h-4 w-4" /> {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Choose a light or dark appearance, or follow your system setting.</p>
        </Card>
      ) : null}

      {tab === 'AI configuration' ? (
        <Card className="max-w-xl p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">AI configuration</h2>
          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Narration</dt><dd className="text-foreground">{h?.narration ?? '—'}</dd>
            <dt className="text-muted-foreground">Mode</dt>
            <dd className="text-foreground">{h?.narration?.startsWith('claude') ? 'Claude rewords the narrative; figures stay from retrieval' : 'Deterministic templates — offline, reproducible'}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">The AI provider and key are read from secure server-side configuration and never exposed to the browser.</p>
        </Card>
      ) : null}

      {tab === 'Data sources' ? (
        <Card className="max-w-xl p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">Data source preferences</h2>
          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Active data layer</dt><dd className="text-foreground">{h?.dataSource ?? '—'}</dd>
            <dt className="text-muted-foreground">Dataset</dt><dd className="text-foreground">{h?.dataset?.counts ? `${h.dataset.counts.issues} issues through ${h.dataset.referenceDate}` : '—'}</dd>
          </dl>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => navigate('/integrations')}>Configure integrations <ChevronRight /></Button>
        </Card>
      ) : null}

      {tab === 'System' ? (
        <Card className="max-w-xl p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">System information</h2>
          <Banner title="Demo build" tone="info">This is a prototype running on synthetic data. The backend is Node and Express; the frontend is React and TypeScript.</Banner>
          <dl className="mt-3 grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Environment</dt><dd className="text-foreground">{h?.env ?? '—'}</dd>
            <dt className="text-muted-foreground">API status</dt><dd className="text-foreground">{h?.status ?? '—'}</dd>
            <dt className="text-muted-foreground">Reference date</dt><dd className="text-foreground">{h?.dataset?.referenceDate ?? '—'}</dd>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
