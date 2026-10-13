import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/lib/i18n';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/pages/login';
import { OverviewPage } from '@/pages/overview';
import { AskPage } from '@/pages/ask';
import { TodayPage } from '@/pages/today';
import { InboxPage } from '@/pages/inbox';
import { DashboardsPage, DashboardViewPage } from '@/pages/dashboards';
import { IssuesPage } from '@/pages/issues';
import { AnalyticsPage } from '@/pages/analytics';
import { ReportsPage } from '@/pages/reports';
import { SourcesPage } from '@/pages/sources';
import { IntegrationsPage } from '@/pages/integrations';
import { HistoryPage } from '@/pages/history';
import { AuditPage } from '@/pages/audit';
import { SettingsPage } from '@/pages/settings';
import { HelpPage } from '@/pages/help';
import { ProfilePage } from '@/pages/profile';

/** Old deep links (/ask?q=…, /command) land on the home chat with their query intact. */
function RedirectHome() {
  const location = useLocation();
  return <Navigate to={`/${location.search}`} replace />;
}

export default function App() {
  const { status } = useAuth();
  const t = useT();

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        {t('app.starting')}
      </div>
    );
  }

  if (status === 'anonymous') {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* The assistant is the home screen: a chat centred on Jervis. */}
        <Route path="/" element={<AskPage />} />
        <Route path="/ask" element={<RedirectHome />} />
        <Route path="/command" element={<RedirectHome />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/dashboards" element={<DashboardsPage />} />
        <Route path="/dashboards/:id" element={<DashboardViewPage />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
