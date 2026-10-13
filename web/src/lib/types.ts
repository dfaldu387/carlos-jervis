export type Role = 'viewer' | 'engineer' | 'manager';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IssueStatus = 'open' | 'in_progress' | 'resolved';
export type ConnectorMode = 'live' | 'mock' | 'planned';

export interface User {
  id: string;
  name: string;
  email: string | null;
  jobTitle: string;
  role: Role;
  roleName: string;
  permissions?: string[];
  via?: string;
}

export interface Health {
  status: string;
  env: string;
  dataSource: string;
  narration: string;
  dataset?: { referenceDate?: string; counts?: Record<string, number> };
}

export interface DemoAccount {
  email: string;
  name: string;
  role: Role;
  roleName: string;
  password: string;
}

export interface Kpi {
  label: string;
  value: number;
  total?: number;
  previous?: number;
  delta?: number;
  help?: string;
  to?: string;
}

export interface Dashboard {
  period: { from: string; to: string; days: number };
  generatedAt: string;
  referenceDate: string;
  kpis: Record<string, Kpi>;
  activityTrend: { date: string; count: number }[];
  issueBreakdown: {
    bySeverity: { key: string; label: string; count: number }[];
    byStatus: { key: string; label: string; count: number }[];
  };
  recentIssues: IssueRow[];
  recentActivity: AuditEvent[];
  sourceHealth: { id: string; name: string; mode: ConnectorMode; lastCheck: LastCheck | null }[];
}

export interface IssueRow {
  id: string;
  title: string;
  severity: Severity;
  status: IssueStatus;
  area: string;
  lineName?: string;
  lineId?: string;
  reportedAt: string;
  date?: string;
  description?: string;
  modelId?: string;
  reworkMinutes?: number;
}

export interface IssuesResponse {
  items: IssueRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
  summary: { total: number; critical: number; open: number; resolved: number };
  areas: { id: string; name: string; area: string }[];
}

export interface IssueDetail {
  issue: IssueRow & { vin?: string; partId?: string; checkpointId?: string; vehicleRemoved?: boolean };
  detail: {
    category: string | null;
    symptom: string;
    part: { id: string; name: string; supplier: string } | null;
    checkpoint: { id: string; name: string } | null;
  };
  timeline: { at: string; kind: string; label: string }[];
  related: { vehicle: IssueRow[]; maintenance: unknown[]; downtime: unknown[] };
  sources: { source: string; label: string; object: string }[];
}

export interface Analytics {
  period: { from: string; to: string; days: number };
  trend: { date: string; count: number }[];
  bySeverity: { key: string; label: string; count: number }[];
  byArea: { key: string; label: string; count: number }[];
  byErrorCode: { key: string; label: string; count: number }[];
  events: { at: string; lineId: string; label: string; durationMinutes: number }[];
}

export interface LastCheck {
  at: string;
  ok: boolean;
  detail: string | null;
  latencyMs: number | null;
}

export interface IntegrationField {
  key: string;
  label: string;
  help: string | null;
  placeholder: string | null;
  required: boolean;
  secret: boolean;
  multiline: boolean;
  fromEnv: boolean;
  value?: string;
  set?: boolean;
  hint?: string;
}

export interface Integration {
  id: string;
  name: string;
  summary: string;
  docsUrl: string | null;
  probe: string;
  liveBehaviour: string;
  enabled: boolean;
  configured: boolean;
  live: boolean;
  mode: ConnectorMode;
  updatedAt: string | null;
  lastCheck: LastCheck | null;
  fields: IntegrationField[];
}

export interface Connector {
  id: string;
  name: string;
  kind: string;
  purpose: string;
  mode: ConnectorMode;
  configured: boolean;
  enabled: boolean;
  lastCheck: LastCheck | null;
  access: string;
  objects: string[];
  capabilities: string[];
  openUrl: string | null;
  securityNote: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  userId: string;
  role: string;
  question: string;
  intent: string | null;
  sources: string[];
  elapsedMs: number;
}

export interface AuditEvent {
  id: string;
  at: string;
  userId: string;
  role: string;
  action: string;
  resource: string;
  outcome: string;
  detail: string | null;
}

export interface AuditResponse {
  stats: { totalQueries: number; bySource: { system: string; count: number }[] };
  entries: AuditEntry[];
  events: AuditEvent[];
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Answer {
  headline: string;
  narrative?: string[];
  provider?: string;
  metrics?: { key: string; label: string; value: number; format: string; source: string; restricted?: boolean }[];
  tables?: { id: string; title: string; source: string; columns: { key: string; label: string; format?: string }[]; rows: Record<string, unknown>[] }[];
  redactions?: { element: string; reason: string }[];
  bullets?: string[];
  spoken?: unknown;
  followUps?: string[];
}

export interface AskResult {
  id: string;
  sessionId: string;
  question: string;
  interpretation?: Record<string, unknown>;
  answer: Answer;
  sources?: { source: string; label: string; object: string; url?: string | null; mode?: string }[];
  trace?: { name: string; detail: string; at: string; [k: string]: unknown }[];
  elapsedMs?: number;
}

export interface CommandCenter {
  status: { overall: string; dataSource: string; narration: string; referenceDate: string; generatedAt: string };
  core: { id: string; label: string; state: string; detail: string }[];
  feed: { id: string; tag: string; tone: string; title: string; detail: string; at: string | null; count?: number; question: string }[];
  agents: { id: string; name: string; state: ConnectorMode; detail: string; capabilities: string[]; openUrl: string | null }[];
  timeline: { shiftId: string; name: string; window: string; issues: number; vehicles: number; reworkMinutes: number; state: string; question: string }[];
  gauges: { key: string; label: string; value: number; format: string; goodHigh: boolean; detail?: string }[];
  today: { issues: number; affected: number; reworked: number; removed: number; reworkMinutes: number; downtimeMinutes: number; openTickets: number };
  trend: { from: string; to: string; points: { date: string; count: number }[] };
  quickCommands: { label: string; question: string }[];
}
