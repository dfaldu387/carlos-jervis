import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

/**
 * Durable audit sink (Postgres).
 *
 * The audit trail is kept in memory for fast reads; this sink mirrors every
 * record to the audit.query_log / audit.events tables (db/schema.sql) so the
 * trail survives a restart, and hydrates the in-memory view on boot. Writes are
 * fire-and-forget from the caller's point of view: a database hiccup is logged
 * but never blocks answering a question or completing an action.
 *
 * The pool is injectable so the SQL mapping can be unit-tested without a live
 * database.
 */
export class PostgresAuditSink {
  constructor({ connectionString, pool } = {}) {
    this.pool = pool ?? new Pool({ connectionString, max: 3 });
    if (!pool) this.pool.on('error', (error) => logger.error('Audit pool error', { error: error.message }));
  }

  async writeQuery(entry) {
    await this.pool.query(
      `INSERT INTO audit.query_log
         (entry_id, logged_at, user_id, role, question, intent, sources, tools_used, redactions, provider, elapsed_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       ON CONFLICT (entry_id) DO NOTHING`,
      [
        entry.id,
        entry.at,
        entry.userId,
        entry.role,
        entry.question,
        entry.intent,
        entry.sources ?? [],
        entry.toolsUsed ?? [],
        JSON.stringify(entry.redactions ?? []),
        entry.provider ?? null,
        entry.elapsedMs ?? null,
      ],
    );
  }

  async writeEvent(event) {
    await this.pool.query(
      `INSERT INTO audit.events
         (event_id, logged_at, user_id, role, action, resource, outcome, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.id,
        event.at,
        event.userId,
        event.role,
        event.action,
        event.resource ?? null,
        event.outcome ?? 'ok',
        event.detail ?? null,
      ],
    );
  }

  // Map a stored query_log row back to the in-memory entry shape.
  static rowToEntry(row) {
    const period =
      row.period_from || row.period_to ? { from: row.period_from, to: row.period_to } : null;
    return {
      id: row.entry_id,
      at: row.logged_at instanceof Date ? row.logged_at.toISOString() : row.logged_at,
      userId: row.user_id,
      role: row.role,
      question: row.question,
      intent: row.intent,
      period,
      sources: row.sources ?? [],
      toolsUsed: row.tools_used ?? [],
      redactions: row.redactions ?? [],
      provider: row.provider ?? 'deterministic',
      elapsedMs: row.elapsed_ms,
    };
  }

  static rowToEvent(row) {
    return {
      id: row.event_id,
      at: row.logged_at instanceof Date ? row.logged_at.toISOString() : row.logged_at,
      userId: row.user_id,
      role: row.role,
      action: row.action,
      resource: row.resource,
      outcome: row.outcome,
      detail: row.detail,
    };
  }

  async recentQueries(limit = 500) {
    const { rows } = await this.pool.query(
      'SELECT * FROM audit.query_log ORDER BY logged_at DESC LIMIT $1',
      [limit],
    );
    return rows.map(PostgresAuditSink.rowToEntry);
  }

  async recentEvents(limit = 500) {
    const { rows } = await this.pool.query(
      'SELECT * FROM audit.events ORDER BY logged_at DESC LIMIT $1',
      [limit],
    );
    return rows.map(PostgresAuditSink.rowToEvent);
  }

  async close() {
    await this.pool.end();
  }
}
