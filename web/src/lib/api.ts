import type {
  Analytics,
  AskResult,
  AuditResponse,
  Briefing,
  CalendarEvent,
  Conversation,
  Dashboard,
  DemoAccount,
  Health,
  Integration,
  IssueDetail,
  IssuesResponse,
  Language,
  MailMessage,
  SavedDashboard,
  SavedDashboardSummary,
  TaskItem,
  User,
} from './types';

const BASE = '/api';

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  if (!response.ok) {
    throw new ApiError((body as { message?: string }).message ?? `Request failed (${response.status})`, response.status);
  }
  return body as T;
}

export const api = {
  me: () => request<{ user: User }>('/auth/me'),
  sso: () => request<{ enabled: boolean; provider: string | null; loginPath: string | null; label: string | null }>('/auth/sso'),
  demoAccounts: () => request<{ accounts: DemoAccount[] }>('/auth/demo-accounts'),
  login: (email: string, password: string) => request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  updateProfile: (payload: { name?: string; jobTitle?: string }) =>
    request<{ user: User }>('/auth/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) }),

  health: () => request<Health>('/health'),
  catalog: () => request<Record<string, unknown>>('/catalog'),
  sources: () => request<{ connectors: import('./types').Connector[]; tools: unknown[]; externalApps: unknown[] }>('/sources'),
  suggestions: () => request<{ groups: { title: string; questions: string[] }[] }>('/suggestions'),
  voiceConfig: (language?: Language) => request<Record<string, unknown>>(`/voice/config${language ? `?language=${language}` : ''}`),
  dashboard: (days = 14) => request<Dashboard>(`/dashboard?days=${days}`),
  issues: (query = '') => request<IssuesResponse>(`/issues${query ? `?${query}` : ''}`),
  issue: (id: string) => request<IssueDetail>(`/issues/${id}`),
  analytics: (query = '') => request<Analytics>(`/analytics${query ? `?${query}` : ''}`),
  conversations: (q = '') => request<{ items: Conversation[]; total: number }>(`/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  conversation: (id: string) => request<{ sessionId: string; turns: { question: string; result: AskResult }[] }>(`/chat/${id}`),
  audit: (limit = 50) => request<AuditResponse>(`/audit?limit=${limit}`),
  integrations: () => request<{ integrations: Integration[] }>('/integrations'),
  saveIntegration: (id: string, payload: { values?: Record<string, string>; enabled?: boolean }) =>
    request<{ integration: Integration }>(`/integrations/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  testIntegration: (id: string) =>
    request<{ result: { ok: boolean; mode: string; detail?: string; latencyMs?: number } }>(`/integrations/${id}/test`, { method: 'POST' }),
  ask: (message: string, sessionId?: string, language?: Language) =>
    request<AskResult>('/chat', { method: 'POST', body: JSON.stringify({ message, sessionId, language }) }),
  dailySummary: (p: { date?: string; line?: string }) =>
    request<AskResult>(`/summaries/daily?${p.date ? `date=${p.date}` : ''}${p.line ? `&line=${p.line}` : ''}`),
  shiftSummary: (p: { date?: string; shift: string }) => request<AskResult>(`/summaries/shift?${p.date ? `date=${p.date}&` : ''}shift=${p.shift}`),

  // ---- AI secretary ---------------------------------------------------------
  mail: (p: { filter?: 'all' | 'unread' | 'needsReply' | 'flagged'; q?: string; limit?: number } = {}) =>
    request<{ items: MailMessage[]; total: number; unread: number; needsReply: number; mode: string }>(`/secretary/mail${qs(p)}`),
  mailItem: (id: string) => request<{ item: MailMessage }>(`/secretary/mail/${id}`),
  updateMail: (id: string, patch: { read?: boolean; flagged?: boolean }) =>
    request<{ item: MailMessage }>(`/secretary/mail/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  draftReply: (id: string, p: { instructions?: string; language?: Language } = {}) =>
    request<{ draft: { subject: string; body: string; tone: string } }>(`/secretary/mail/${id}/draft`, { method: 'POST', body: JSON.stringify(p) }),
  // Sending always carries an explicit confirmation; the server refuses without it.
  sendReply: (id: string, body: string) =>
    request<{ ok: boolean; mode: 'simulated' | 'sent' }>(`/secretary/mail/${id}/reply`, { method: 'POST', body: JSON.stringify({ body, confirm: true }) }),
  calendar: (day: string = 'today') => request<{ items: CalendarEvent[]; day: string }>(`/secretary/calendar?day=${encodeURIComponent(day)}`),
  tasks: (status: 'open' | 'done' | 'all' = 'open') => request<{ items: TaskItem[] }>(`/secretary/tasks?status=${status}`),
  createTask: (p: { title: string; dueAt?: string | null; relatedMailId?: string | null }) =>
    request<{ item: TaskItem }>('/secretary/tasks', { method: 'POST', body: JSON.stringify(p) }),
  updateTask: (id: string, patch: { status?: 'open' | 'done'; title?: string; dueAt?: string | null }) =>
    request<{ item: TaskItem }>(`/secretary/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id: string) => request<{ ok: boolean }>(`/secretary/tasks/${id}`, { method: 'DELETE' }),
  briefing: (language: Language = 'en') => request<Briefing>(`/secretary/briefing?language=${language}`),

  // Power Automate: run a flow Jervis proposed, with the explicit confirmation the server requires.
  triggerFlow: (p: { flow: string; payload?: Record<string, unknown> }) =>
    request<{ ok: boolean; mode: 'simulated' | 'live'; runId?: string }>('/automate/trigger', {
      method: 'POST',
      body: JSON.stringify({ ...p, confirm: true }),
    }),

  dashboards: (language?: Language) => request<{ items: SavedDashboardSummary[] }>(`/dashboards${language ? `?language=${language}` : ''}`),
  createDashboard: (p: { question?: string; title?: string; language?: Language }) =>
    request<{ item: SavedDashboard }>('/dashboards', { method: 'POST', body: JSON.stringify(p) }),
  dashboardById: (id: string, language?: Language) =>
    request<{ item: SavedDashboard }>(`/dashboards/${id}${language ? `?language=${language}` : ''}`),
  deleteDashboard: (id: string) => request<{ ok: boolean }>(`/dashboards/${id}`, { method: 'DELETE' }),
};

/** Builds a query string from defined values only. */
function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
