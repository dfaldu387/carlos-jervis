import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/pages/login';
import { OverviewPage } from '@/pages/overview';
import { AskPage } from '@/pages/ask';
import { CommandPage } from '@/pages/command';
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

export default function App() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        Starting Jervis…
      </div>
    );
  }

  if (status === 'anonymous') {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/command" element={<CommandPage />} />
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
