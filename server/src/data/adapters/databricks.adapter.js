import { ProductionRepository } from '../repository.js';
import { resolve_ } from '../../integrations/store.js';
import { logger } from '../../utils/logger.js';

/**
 * Databricks adapter.
 *
 * Fulfils the production-data contract against a Databricks SQL warehouse
 * through the Statement Execution API (no driver dependency; the API speaks
 * JSON over HTTPS). Every method issues parameterised SQL built from the same
 * filter the in-memory adapter honours, so swapping JERVIS_DATA_SOURCE from
 * memory to databricks changes nothing above this file.
 *
 * Selected with: JERVIS_DATA_SOURCE=databricks, plus the Databricks
 * integration configured on the Integrations page or via env.
 *
 * Schema expected: {catalog}.{schema}.issue_events / tickets / downtime_events,
 * matching db/schema.sql.
 */

const WHERE_COLUMNS = {
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

const buildWhere = (filter = {}, alias = 'i') => {
  const clauses = [];
  const params = [];
  for (const [key, [column, op]] of Object.entries(WHERE_COLUMNS)) {
    const value = filter[key];
    if (value === undefined || value === null || value === '') continue;
    clauses.push(`${alias}.${column} ${op} :p${params.length}`);
    params.push(String(value));
  }
  return { text: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
};

const camel = (row) => ({
  id: row.id,
  date: row.issue_date,
  detectedAt: row.detected_at,
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

export class DatabricksRepository extends ProductionRepository {
  constructor() {
    super();
    const cfg = resolve_('databricks');
    this.host = (cfg.host ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.token = cfg.token ?? '';
    this.warehouseId = cfg.warehouseId ?? '';
    this.catalog = cfg.catalog || 'main';
    this.schema = cfg.schema || 'prod_quality';
  }

  table(name) {
    return `${this.catalog}.${this.schema}.${name}`;
  }

  /**
   * Execute one parameterised statement and return rows as objects. Named
   * parameters (:p0, :p1, ...) are passed as the API's typed parameter list -
   * values never reach the SQL string, so the query is injection-safe.
   */
  async query(statement, params = []) {
    const response = await fetch(`https://${this.host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        warehouse_id: this.warehouseId,
        statement,
        wait_timeout: '30s',
        parameters: params.map((value, index) => ({
          name: `p${index}`,
          value: String(value),
          type: 'STRING',
        })),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw Object.assign(new Error(`Databricks query failed (${response.status}) ${detail.slice(0, 200)}`), {
        statusCode: 502,
      });
    }

    const body = await response.json();
    if (body.status?.state === 'FAILED') {
      throw Object.assign(new Error(body.status?.error?.message ?? 'Databricks statement failed'), {
        statusCode: 502,
      });
    }

    const columns = body.manifest?.schema?.columns ?? [];
    const rows = body.result?.data_array ?? [];
    return rows.map((cells) =>
      Object.fromEntries(columns.map((col, index) => [col.name, cells[index]])),
    );
  }

  async meta() {
    try {
      const [{ n } = { n: 0 }] = await this.query(`SELECT count(*) AS n FROM ${this.table('issue_events')}`);
      const [{ ref } = {}] = await this.query(
        `SELECT max(issue_date) AS ref FROM ${this.table('issue_events')}`,
      );
      return {
        adapter: 'databricks',
        connected: true,
        referenceDate: ref ?? null,
        counts: { issues: Number(n ?? 0) },
      };
    } catch (error) {
      logger.error('Databricks meta() failed', { error: error.message });
      return { adapter: 'databricks', connected: false, note: error.message };
    }
  }

  async listIssues(filter = {}) {
    const { text, params } = buildWhere(filter);
    const limit = Number.isFinite(filter.limit) ? ` LIMIT ${Math.min(500, Math.max(1, filter.limit))}` : '';
    const rows = await this.query(
      `SELECT * FROM ${this.table('issue_events')} i ${text} ORDER BY i.detected_at DESC${limit}`,
      params,
    );
    return rows.map(camel);
  }

  async countIssues(filter = {}) {
    const { text, params } = buildWhere(filter);
    const [{ n } = { n: 0 }] = await this.query(
      `SELECT count(*) AS n FROM ${this.table('issue_events')} i ${text}`,
      params,
    );
    return Number(n ?? 0);
  }

  async aggregateIssues(filter = {}, dimension = 'errorCode') {
    const column = DIMENSION_COLUMNS[dimension] ?? 'error_code';
    const { text, params } = buildWhere(filter);
    const limit = Number.isFinite(filter.limit) ? ` LIMIT ${Math.min(100, Math.max(1, filter.limit))}` : '';
    const rows = await this.query(
      `SELECT i.${column} AS key, count(*) AS count,
              count(DISTINCT i.vin) AS vehicles,
              coalesce(sum(i.rework_minutes), 0) AS rework_minutes,
              count_if(i.vehicle_removed) AS removed
       FROM ${this.table('issue_events')} i ${text}
       GROUP BY i.${column} ORDER BY count DESC, key ASC${limit}`,
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
      `SELECT count(DISTINCT i.vin) AS affected,
              count(DISTINCT CASE WHEN i.rework_minutes > 0 THEN i.vin END) AS reworked,
              count(DISTINCT CASE WHEN i.vehicle_removed THEN i.vin END) AS removed,
              coalesce(sum(i.rework_minutes), 0) AS rework_minutes
       FROM ${this.table('issue_events')} i ${text}`,
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
    const { text, params } = buildWhere(filter, 'i');
    const limit = Number.isFinite(filter.limit) ? ` LIMIT ${Math.min(200, Math.max(1, filter.limit))}` : '';
    const rows = await this.query(
      `SELECT * FROM ${this.table('tickets')} i ${text} ORDER BY i.opened_at DESC${limit}`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      date: row.ticket_date ?? row.issue_date,
      shiftId: row.shift_id,
      assetId: row.asset_id,
      assetName: row.asset_name,
      lineId: row.line_id,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      status: row.status,
      priority: row.priority,
      description: row.description,
      technician: row.technician,
    }));
  }

  async listDowntime(filter = {}) {
    const { text, params } = buildWhere(filter, 'i');
    const limit = Number.isFinite(filter.limit) ? ` LIMIT ${Math.min(200, Math.max(1, filter.limit))}` : '';
    const rows = await this.query(
      `SELECT * FROM ${this.table('downtime_events')} i ${text} ORDER BY i.duration_minutes DESC${limit}`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      date: row.event_date ?? row.issue_date,
      shiftId: row.shift_id,
      lineId: row.line_id,
      assetId: row.asset_id,
      topic: row.topic,
      startedAt: row.started_at,
      durationMinutes: Number(row.duration_minutes ?? 0),
      reason: row.reason,
    }));
  }

  async dailyTrend(filter = {}) {
    const { text, params } = buildWhere(filter);
    const rows = await this.query(
      `SELECT i.issue_date AS date, count(*) AS count
       FROM ${this.table('issue_events')} i ${text}
       GROUP BY i.issue_date ORDER BY i.issue_date`,
      params,
    );
    return rows.map((row) => ({ date: row.date, count: Number(row.count ?? 0) }));
  }
}
