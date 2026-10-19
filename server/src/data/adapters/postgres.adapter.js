import pg from 'pg';
import { ProductionRepository } from '../repository.js';
import { logger } from '../../utils/logger.js';

const { Pool } = pg;

/**
 * Postgres adapter.
 *
 * Fulfils the production-data contract against the schema in db/schema.sql.
 * Every method issues parameterised SQL built from the same filter the
 * in-memory adapter honours, so swapping JERVIS_DATA_SOURCE from memory to
 * postgres changes nothing above this file. Values are passed as positional
 * parameters ($1, $2, ...) and never concatenated into the statement, so the
 * query is injection-safe.
 *
 * Selected with: JERVIS_DATA_SOURCE=postgres DATABASE_URL=postgres://...
 */

// Filter key -> [column, operator]. One map per table because the maintenance
// and telemetry tables do not carry the production dimensions, and asking for a
// column that does not exist would error rather than return nothing.
const ISSUE_COLUMNS = {
  from: ['issue_date', '>='],
  to: ['issue_date', '<='],
  shiftId: ['shift_id', '='],
  lineId: ['line_id', '='],
  modelId: ['model_id', '='],
  errorCode: ['error_code', '='],
  partId: ['part_id', '='],
  costCenter: ['cost_center', '='],
  checkpointId: ['checkpoint_id', '='],
  severity: ['severity', '='],
  reworkCategoryId: ['rework_category_id', '='],
  status: ['status', '='],
  vin: ['vin', '='],
};

const MAINTENANCE_COLUMNS = {
  from: ['ticket_date', '>='],
  to: ['ticket_date', '<='],
  shiftId: ['shift_id', '='],
  lineId: ['line_id', '='],
  status: ['status', '='],
};

const DOWNTIME_COLUMNS = {
  from: ['event_date', '>='],
  to: ['event_date', '<='],
  shiftId: ['shift_id', '='],
  lineId: ['line_id', '='],
};

const DIMENSION_COLUMNS = {
  date: 'issue_date',
  shiftId: 'shift_id',
  lineId: 'line_id',
  modelId: 'model_id',
  errorCode: 'error_code',
  partId: 'part_id',
  costCenter: 'cost_center',
  checkpointId: 'checkpoint_id',
  severity: 'severity',
  reworkCategoryId: 'rework_category_id',
  category: 'category',
  status: 'status',
};

/**
 * Builds the WHERE fragment plus ordered parameter list from a filter, using
 * the supplied column map so only valid columns for that table are referenced.
 * Exported for unit testing without a database.
 */
export const buildWhere = (filter = {}, columns = ISSUE_COLUMNS, alias = 'i') => {
  const clauses = [];
  const params = [];
  for (const [key, [column, op]] of Object.entries(columns)) {
    const value = filter[key];
    if (value === undefined || value === null || value === '') continue;
    params.push(value);
    clauses.push(`${alias}.${column} ${op} $${params.length}`);
  }
  return {
    text: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
};

// Clamp a caller-supplied limit to a positive integer bounded by `max`.
const clampLimit = (limit, max) =>
  Number.isFinite(limit) ? Math.min(max, Math.max(1, Math.trunc(limit))) : null;

// Map a joined issue_events row to the camelCase shape the tools consume
// (identical to the seeded in-memory rows and the Databricks adapter output).
const camelIssue = (row) => ({
  id: row.issue_id,
  date: typeof row.issue_date === 'string' ? row.issue_date : toDateKey(row.issue_date),
  detectedAt: row.detected_at instanceof Date ? row.detected_at.toISOString() : row.detected_at,
  shiftId: row.shift_id,
  lineId: row.line_id,
  modelId: row.model_id,
  vin: row.vin,
  errorCode: row.error_code,
  errorDescription: row.error_description,
  category: row.category,
  symptom: row.symptom,
  partId: row.part_id,
  costCenter: row.cost_center,
  checkpointId: row.checkpoint_id,
  severity: row.severity,
  reworkCategoryId: row.rework_category_id,
  vehicleRemoved: row.vehicle_removed === true || row.vehicle_removed === 'true',
  reworkMinutes: Number(row.rework_minutes ?? 0),
  status: row.status,
});

// Postgres returns `date` columns as JS Date at local midnight; the contract
// uses a plain YYYY-MM-DD string. Format in UTC-agnostic calendar terms.
const toDateKey = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export class PostgresRepository extends ProductionRepository {
  constructor({ connectionString } = {}) {
    super();
    this.connectionString = connectionString;
    this.pool = null;
  }

  pool_() {
    if (!this.pool) {
      if (!this.connectionString) {
        throw Object.assign(new Error('DATABASE_URL is not set; the postgres adapter needs a connection string.'), {
          statusCode: 500,
        });
      }
      this.pool = new Pool({ connectionString: this.connectionString, max: 5 });
      this.pool.on('error', (error) => logger.error('Postgres pool error', { error: error.message }));
    }
    return this.pool;
  }

  async query(text, params = []) {
    try {
      const result = await this.pool_().query(text, params);
      return result.rows;
    } catch (error) {
      logger.error('Postgres query failed', { error: error.message });
      throw Object.assign(new Error(`Postgres query failed: ${error.message}`), { statusCode: 502 });
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async meta() {
    try {
      const [{ n } = { n: 0 }] = await this.query('SELECT count(*)::int AS n FROM production.issue_events');
      const [{ ref } = {}] = await this.query('SELECT max(issue_date) AS ref FROM production.issue_events');
      const [{ tickets } = { tickets: 0 }] = await this.query(
        'SELECT count(*)::int AS tickets FROM maintenance.tickets',
      );
      const [{ downtime } = { downtime: 0 }] = await this.query(
        'SELECT count(*)::int AS downtime FROM telemetry.downtime_events',
      );
      return {
        adapter: 'postgres',
        connected: true,
        referenceDate: ref ? toDateKey(ref) : null,
        counts: {
          issues: Number(n ?? 0),
          maintenanceTickets: Number(tickets ?? 0),
          downtimeEvents: Number(downtime ?? 0),
        },
      };
    } catch (error) {
      return { adapter: 'postgres', connected: false, note: error.message };
    }
  }

  async listIssues(filter = {}) {
    const { text, params } = buildWhere(filter);
    const limit = clampLimit(filter.limit, 500);
    const rows = await this.query(
      `SELECT i.issue_id, i.issue_date, i.detected_at, i.shift_id, i.line_id, i.model_id, i.vin,
              i.error_code, e.description AS error_description, e.category, e.symptom,
              i.part_id, i.cost_center, i.checkpoint_id, i.severity, i.rework_category_id,
              i.vehicle_removed, i.rework_minutes, i.status
       FROM production.issue_events i
       LEFT JOIN production.error_codes e ON e.error_code = i.error_code
       ${text}
       ORDER BY i.detected_at DESC${limit ? ` LIMIT ${limit}` : ''}`,
      params,
    );
    return rows.map(camelIssue);
  }

  async countIssues(filter = {}) {
    const { text, params } = buildWhere(filter);
    const [{ n } = { n: 0 }] = await this.query(
      `SELECT count(*)::int AS n FROM production.issue_events i ${text}`,
      params,
    );
    return Number(n ?? 0);
  }

  async aggregateIssues(filter = {}, dimension = 'errorCode') {
    const column = DIMENSION_COLUMNS[dimension] ?? 'error_code';
    const { text, params } = buildWhere(filter);
    const limit = clampLimit(filter.limit, 100);
    // `category` lives on error_codes, so it needs the join; the other
    // dimensions are columns on issue_events itself.
    const needsJoin = column === 'category';
    const rows = await this.query(
      `SELECT ${needsJoin ? 'e' : 'i'}.${column} AS key,
              count(*)::int AS count,
              count(DISTINCT i.vin)::int AS vehicles,
              coalesce(sum(i.rework_minutes), 0)::int AS rework_minutes,
              count(*) FILTER (WHERE i.vehicle_removed)::int AS removed
       FROM production.issue_events i
       ${needsJoin ? 'LEFT JOIN production.error_codes e ON e.error_code = i.error_code' : ''}
       ${text}
       GROUP BY 1 ORDER BY count DESC, key ASC${limit ? ` LIMIT ${limit}` : ''}`,
      params,
    );
    return rows.map((row) => ({
      key: String(row.key ?? 'unknown'),
      count: Number(row.count ?? 0),
      vehicles: Number(row.vehicles ?? 0),
      reworkMinutes: Number(row.rework_minutes ?? 0),
      removed: Number(row.removed ?? 0),
    }));
  }

  async vehicleImpact(filter = {}) {
    const { text, params } = buildWhere(filter);
    const [row = {}] = await this.query(
      `SELECT count(DISTINCT i.vin)::int AS affected,
              count(DISTINCT i.vin) FILTER (WHERE i.rework_minutes > 0)::int AS reworked,
              count(DISTINCT i.vin) FILTER (WHERE i.vehicle_removed)::int AS removed,
              coalesce(sum(i.rework_minutes), 0)::int AS rework_minutes
       FROM production.issue_events i ${text}`,
      params,
    );
    return {
      affected: Number(row.affected ?? 0),
      reworked: Number(row.reworked ?? 0),
      removed: Number(row.removed ?? 0),
      reworkMinutes: Number(row.rework_minutes ?? 0),
    };
  }

  async listMaintenance(filter = {}) {
    const { text, params } = buildWhere(filter, MAINTENANCE_COLUMNS);
    const limit = clampLimit(filter.limit, 200);
    const rows = await this.query(
      `SELECT i.ticket_id, i.ticket_date, i.shift_id, i.asset_id, a.name AS asset_name,
              i.line_id, i.opened_at, i.closed_at, i.status, i.priority, i.description, i.technician
       FROM maintenance.tickets i
       LEFT JOIN maintenance.assets a ON a.asset_id = i.asset_id
       ${text}
       ORDER BY i.opened_at DESC${limit ? ` LIMIT ${limit}` : ''}`,
      params,
    );
    return rows.map((row) => ({
      id: row.ticket_id,
      date: toDateKey(row.ticket_date),
      shiftId: row.shift_id,
      assetId: row.asset_id,
      assetName: row.asset_name,
      lineId: row.line_id,
      openedAt: row.opened_at instanceof Date ? row.opened_at.toISOString() : row.opened_at,
      closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : row.closed_at,
      status: row.status,
      priority: row.priority,
      description: row.description,
      technician: row.technician,
    }));
  }

  async listDowntime(filter = {}) {
    const { text, params } = buildWhere(filter, DOWNTIME_COLUMNS);
    const limit = clampLimit(filter.limit, 200);
    const rows = await this.query(
      `SELECT i.event_id, i.event_date, i.shift_id, i.line_id, i.asset_id, i.topic,
              i.started_at, i.duration_minutes, i.reason
       FROM telemetry.downtime_events i
       ${text}
       ORDER BY i.duration_minutes DESC${limit ? ` LIMIT ${limit}` : ''}`,
      params,
    );
    return rows.map((row) => ({
      id: row.event_id,
      date: toDateKey(row.event_date),
      shiftId: row.shift_id,
      lineId: row.line_id,
      assetId: row.asset_id,
      topic: row.topic,
      startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
      durationMinutes: Number(row.duration_minutes ?? 0),
      reason: row.reason,
    }));
  }

  async dailyTrend(filter = {}) {
    const { text, params } = buildWhere(filter);
    const rows = await this.query(
      `SELECT i.issue_date AS date, count(*)::int AS count
       FROM production.issue_events i ${text}
       GROUP BY i.issue_date ORDER BY i.issue_date`,
      params,
    );
    return rows.map((row) => ({ date: toDateKey(row.date), count: Number(row.count ?? 0) }));
  }
}
