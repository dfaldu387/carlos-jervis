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
import { LANGUAGES, useI18n } from '@/lib/i18n';

const TABS = ['settings.tab.appearance', 'settings.tab.ai', 'settings.tab.data', 'settings.tab.system'] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const navigate = useNavigate();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  const [tab, setTab] = useState<Tab>('settings.tab.appearance');
  const { t, language, setLanguage } = useI18n();
  const [theme, setTheme] = useState<ThemePref>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const h = health.data;

  return (
    <div>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-semibold ${tab === tabKey ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t(tabKey)}
          </button>
        ))}
      </div>

      {tab === 'settings.tab.appearance' ? (
        <Card className="max-w-xl p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">{t('settings.theme')}</h2>
          <div className="inline-flex overflow-hidden rounded-md border border-input">
            {(
              [
                ['light', Sun],
                ['dark', Moon],
                ['system', Monitor],
              ] as const
            ).map(([value, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={`flex items-center gap-2 px-3.5 py-2 text-sm ${theme === value ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
              >
                <Icon className="h-4 w-4" /> {t(`settings.theme.${value}`)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('settings.themeHelp')}</p>

          <h2 className="mb-3 mt-6 text-base font-semibold text-foreground">{t('settings.language')}</h2>
          <div className="inline-flex overflow-hidden rounded-md border border-input">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLanguage(l.id)}
                className={`px-3.5 py-2 text-sm ${language === l.id ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('settings.languageHelp')}</p>
        </Card>
      ) : null}

      {tab === 'settings.tab.ai' ? (
        <Card className="max-w-xl p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">{t('settings.ai')}</h2>
          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('settings.narration')}</dt>
            <dd className="text-foreground">{h?.narration ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.mode')}</dt>
            <dd className="text-foreground">{h?.narration?.startsWith('claude') ? t('settings.mode.claude') : t('settings.mode.template')}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t('settings.aiHelp')}</p>
        </Card>
      ) : null}

      {tab === 'settings.tab.data' ? (
        <Card className="max-w-xl p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">{t('settings.dataPrefs')}</h2>
          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('settings.dataLayer')}</dt>
            <dd className="text-foreground">{h?.dataSource ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.dataset')}</dt>
            <dd className="text-foreground">
              {h?.dataset?.counts ? t('settings.datasetValue', { issues: h.dataset.counts.issues, date: h.dataset.referenceDate ?? '' }) : '—'}
            </dd>
          </dl>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => navigate('/integrations')}>
            {t('settings.configure')} <ChevronRight />
          </Button>
        </Card>
      ) : null}

      {tab === 'settings.tab.system' ? (
        <Card className="max-w-xl p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">{t('settings.system')}</h2>
          <Banner title={t('settings.demoBuild')} tone="info">
            {t('settings.demoBody')}
          </Banner>
          <dl className="mt-3 grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('settings.environment')}</dt>
            <dd className="text-foreground">{h?.env ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.apiStatus')}</dt>
            <dd className="text-foreground">{h?.status ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.referenceDate')}</dt>
            <dd className="text-foreground">{h?.dataset?.referenceDate ?? '—'}</dd>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
