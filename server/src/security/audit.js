import { config } from '../config.js';
import { newId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';

/**
 * Query audit trail.
 *
 * Every question, the role that asked it, the systems that were read and
 * anything withheld. Kept in memory for fast reads; when a durable sink is
 * attached (Postgres, see audit-sink.js) every record is also mirrored to the
 * database so the trail survives a restart, and the in-memory view is hydrated
 * from the database on boot. Sink writes are fire-and-forget: a database error
 * is logged but never blocks answering a question.
 */

const entries = [];
const events = [];

let sink = null;

/** Attach (or detach with null) a durable audit sink. */
export const setAuditSink = (nextSink) => {
  sink = nextSink;
};

/** Load the most recent persisted records into the in-memory view on startup. */
export const hydrateAudit = async () => {
  if (!sink) return;
  try {
    const [persistedEntries, persistedEvents] = await Promise.all([
      sink.recentQueries(config.audit.retainEntries),
      sink.recentEvents(config.audit.retainEntries),
    ]);
    entries.splice(0, entries.length, ...persistedEntries);
    events.splice(0, events.length, ...persistedEvents);
    logger.info('Audit trail hydrated from durable store', {
      entries: entries.length,
      events: events.length,
    });
  } catch (error) {
    logger.error('Audit hydration failed; starting with an empty in-memory trail', {
      error: error.message,
    });
  }
};

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
  if (sink) sink.writeEvent(event).catch((error) => logger.error('Audit event persist failed', { error: error.message }));
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
  if (sink) sink.writeQuery(entry).catch((error) => logger.error('Audit query persist failed', { error: error.message }));
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
