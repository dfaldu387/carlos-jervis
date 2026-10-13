import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Sparkles,
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Database,
  Plug,
  History,
  ScrollText,
  Settings as SettingsIcon,
  HelpCircle,
  ChevronsLeft,
  LogOut,
  UserRound,
  Menu,
  X,
  ChevronDown,
  Gauge,
  Search,
  Bell,
  Sun,
  Moon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { applyTheme, getStoredTheme } from '@/lib/theme';
import { VoiceProvider } from '@/hooks/voice-provider';
import { GlobalVoice } from '@/components/global-voice';
import { api } from '@/lib/api';
import { cn, initialsOf } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Workspace',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/ask', label: 'Ask Jervis', icon: Sparkles },
      { to: '/issues', label: 'Production Issues', icon: AlertTriangle },
      { to: '/analytics', label: 'Production Analytics', icon: BarChart3 },
      { to: '/reports', label: 'Shift Reports', icon: ClipboardList },
    ],
  },
  {
    group: 'Data & Systems',
    items: [
      { to: '/sources', label: 'Data Sources', icon: Database },
      { to: '/integrations', label: 'Integrations', icon: Plug },
    ],
  },
  {
    group: 'Activity',
    items: [
      { to: '/history', label: 'Conversation History', icon: History },
      { to: '/audit', label: 'Audit Logs', icon: ScrollText },
    ],
  },
];

const BOTTOM: NavItem[] = [{ to: '/help', label: 'Help', icon: HelpCircle }];

const TITLES: Record<string, string> = {
  '/': 'Overview',
  '/ask': 'Ask Jervis',
  '/issues': 'Production Issues',
  '/analytics': 'Production Analytics',
  '/reports': 'Shift Reports',
  '/sources': 'Data Sources',
  '/integrations': 'Integrations',
  '/history': 'Conversation History',
  '/audit': 'Audit Logs',
  '/settings': 'Settings',
  '/help': 'Help',
  '/profile': 'User Profile',
  '/command': 'Command Center',
};

const COLLAPSE_KEY = 'jervis.sidebar.collapsed';

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const title = TITLES[location.pathname] ?? 'Jervis AI';
  const group =
    NAV.find((s) => s.items.some((i) => i.to === location.pathname))?.group ??
    (['/settings', '/help', '/profile', '/command'].includes(location.pathname) ? 'Account' : 'Workspace');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dark, setDark] = useState(() => {
    const t = getStoredTheme();
    return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });
  const toggleTheme = () => {
    const next = !dark;
    applyTheme(next ? 'dark' : 'light');
    setDark(next);
  };

  const criticalCount = useQuery({
    queryKey: ['critical-open'],
    queryFn: () => api.issues('severity=critical&status=open&pageSize=1'),
    select: (d) => d.total,
    staleTime: 60_000,
  });

  const sourcesQuery = useQuery({ queryKey: ['sources'], queryFn: () => api.sources(), staleTime: 60_000 });
  const liveCount = sourcesQuery.data?.connectors.filter((c) => c.mode === 'live').length ?? 0;
  const statusLabel = !sourcesQuery.data ? '' : liveCount > 0 ? 'Live sources' : 'Demo mode';

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const badge = item.to === '/issues' ? criticalCount.data : undefined;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        title={collapsed ? item.label : undefined}
        onClick={() => setMobileOpen(false)}
        className={({ isActive }) =>
          cn(
            'group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
            collapsed && 'justify-center px-0',
            isActive
              ? 'bg-primary/10 text-primary'
              : 'text-slate-600 hover:bg-secondary hover:text-foreground dark:text-slate-300',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive ? (
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
            ) : null}
            <Icon className={cn('h-[18px] w-[18px] flex-none', !isActive && 'text-slate-400')} />
            {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
            {!collapsed && badge ? (
              <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
                {badge}
              </span>
            ) : null}
          </>
        )}
      </NavLink>
    );
  };

  const sidebar = (
    <aside
      className={cn(
        'relative flex h-full flex-col bg-card transition-[width]',
        collapsed ? 'w-[72px]' : 'w-[264px]',
      )}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-3 top-5 z-30 hidden h-6 w-6 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground lg:grid"
      >
        <ChevronsLeft className={cn('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} />
      </button>

      <div className={cn('flex items-center gap-2.5 px-4 py-4', collapsed && 'justify-center pb-2 pt-4')}>
        <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary text-base font-bold text-primary-foreground shadow-sm">
          J
        </span>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-foreground">Jervis AI</div>
            <div className="text-[11px] text-muted-foreground">Production Intelligence</div>
          </div>
        ) : null}
      </div>

      <nav className={cn('flex-1 overflow-y-auto px-3', collapsed ? 'pt-1' : 'py-2')}>
        {NAV.map((section, idx) => (
          <div key={section.group} className={collapsed ? '' : 'mb-1'}>
            {!collapsed ? (
              <div className="px-3 pb-1.5 pt-3 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                {section.group}
              </div>
            ) : idx > 0 ? (
              <div className="mx-auto my-1.5 h-px w-7 bg-border" />
            ) : null}
            <div className="flex flex-col gap-0.5">{section.items.map(renderItem)}</div>
          </div>
        ))}
      </nav>

      <div className="p-3">
        <div className="flex flex-col gap-0.5">{BOTTOM.map(renderItem)}</div>
      </div>

      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-secondary',
                collapsed && 'justify-center',
              )}
            >
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {initialsOf(user?.name)}
              </span>
              {!collapsed ? (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{user?.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{user?.roleName}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" />
                </>
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-[240px]">
            <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/command')}>
              <Gauge /> Command Center
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <UserRound /> User profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <SettingsIcon /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );

  return (
    <VoiceProvider>
    <div className="flex h-full bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebar}</div>

      {/* Mobile sidebar */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[264px]">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top strip (hidden on desktop to keep it clean) */}
        <div className="flex items-center gap-3 bg-card px-4 py-3 lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-md border border-border"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="font-bold text-foreground">Jervis AI</span>
        </div>

        {/* Top nav */}
        <header className="hidden items-center gap-4 bg-card px-8 py-3 shadow-sm lg:flex">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">{group}</span>
            <span className="text-muted-foreground">/</span>
            <span className="font-semibold text-foreground">{title}</span>
          </div>

          <div className="flex-1" />

          <form
            className="relative w-72"
            onSubmit={(e) => {
              e.preventDefault();
              if (!search.trim()) return;
              navigate(`/issues?q=${encodeURIComponent(search.trim())}`);
              setSearch('');
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issues…"
              className="h-9 rounded-full bg-secondary/60 pl-9"
            />
          </form>

          {statusLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span className={cn('h-1.5 w-1.5 rounded-full', liveCount > 0 ? 'bg-success' : 'bg-warning')} />
              {statusLabel}
            </span>
          ) : null}

          <button
            type="button"
            onClick={toggleTheme}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>

          <button
            type="button"
            onClick={() => navigate('/issues?severity=critical&status=open')}
            title="Critical open issues"
            className="relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Bell className="h-[18px] w-[18px]" />
            {criticalCount.data ? (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {criticalCount.data}
              </span>
            ) : null}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1320px] px-5 py-6 lg:px-8 lg:py-7">
            <Outlet />
          </div>
        </main>
      </div>

      <GlobalVoice />
    </div>
    </VoiceProvider>
  );
}
