import type {
  Analytics,
  AskResult,
  AuditResponse,
  Conversation,
  Dashboard,
  DemoAccount,
  Health,
  Integration,
  IssueDetail,
  IssuesResponse,
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
  demoAccounts: () => request<{ accounts: DemoAccount[] }>('/auth/demo-accounts'),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  updateProfile: (payload: { name?: string; jobTitle?: string }) =>
    request<{ user: User }>('/auth/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) }),

  health: () => request<Health>('/health'),
  catalog: () => request<Record<string, unknown>>('/catalog'),
  sources: () => request<{ connectors: import('./types').Connector[]; tools: unknown[]; externalApps: unknown[] }>('/sources'),
  suggestions: () => request<{ groups: { title: string; questions: string[] }[] }>('/suggestions'),
  voiceConfig: () => request<Record<string, unknown>>('/voice/config'),
  dashboard: (days = 14) => request<Dashboard>(`/dashboard?days=${days}`),
  commandCenter: () => request<import('./types').CommandCenter>('/command-center'),
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
  ask: (message: string, sessionId?: string) =>
    request<AskResult>('/chat', { method: 'POST', body: JSON.stringify({ message, sessionId }) }),
  dailySummary: (p: { date?: string; line?: string }) =>
    request<AskResult>(`/summaries/daily?${p.date ? `date=${p.date}` : ''}${p.line ? `&line=${p.line}` : ''}`),
  shiftSummary: (p: { date?: string; shift: string }) =>
    request<AskResult>(`/summaries/shift?${p.date ? `date=${p.date}&` : ''}shift=${p.shift}`),
};
