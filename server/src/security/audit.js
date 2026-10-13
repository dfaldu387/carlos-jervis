import { config } from '../config.js';
import { newId } from '../utils/ids.js';

/**
 * Query audit trail.
 *
 * Every question, the role that asked it, the systems that were read and
 * anything withheld. In-memory for the prototype; the same records belong in a
 * durable store once the database is integrated.
 */

const entries = [];
const events = [];

/**
 * General audit event: actor, action, resource, outcome. Covers administrative
 * actions such as configuring an integration, separate from the per-question
 * query log above.
 */
export const recordAudit = ({ access, action, resource, outcome = 'ok', detail = null }) => {
  if (!config.audit.enabled) return null;
  const event = {
    id: newId('evt'),
    at: new Date().toISOString(),
    userId: access?.userId ?? 'unknown',
    role: access?.role ?? 'unknown',
    action,
    resource,
    outcome,
    detail,
  };
  events.unshift(event);
  if (events.length > config.audit.retainEntries) events.length = config.audit.retainEntries;
  return event;
};

export const listEvents = ({ limit = 50 } = {}) => events.slice(0, limit);

export const recordQuery = ({ question, access, result }) => {
  if (!config.audit.enabled) return null;

  const entry = {
    id: newId('audit'),
    at: new Date().toISOString(),
    userId: access.userId,
    role: access.role,
    question,
    intent: result.interpretation?.intent ?? null,
    period: result.interpretation?.period ?? null,
    sources: (result.sources ?? []).map((source) => `${source.label}:${source.object}`),
    toolsUsed: (result.trace ?? [])
      .filter((step) => step.name === 'retrieve' && !step.failed)
      .map((step) => step.tool),
    redactions: result.answer?.redactions ?? [],
    provider: result.answer?.provider ?? 'deterministic',
    elapsedMs: result.elapsedMs,
  };

  entries.unshift(entry);
  if (entries.length > config.audit.retainEntries) entries.length = config.audit.retainEntries;
  return entry;
};

export const listAudit = ({ limit = 50 } = {}) => entries.slice(0, limit);

export const auditStats = () => {
  const bySource = new Map();
  for (const entry of entries) {
    for (const source of entry.sources) {
      const system = source.split(':')[0];
      bySource.set(system, (bySource.get(system) ?? 0) + 1);
    }
  }
  return {
    totalQueries: entries.length,
    bySource: [...bySource.entries()].map(([system, count]) => ({ system, count })),
  };
};
