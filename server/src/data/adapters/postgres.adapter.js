import { ProductionRepository } from '../repository.js';

/**
 * Database seam.
 *
 * This is where the real integration lands. The SQL is written out so the
 * remaining work is wiring a driver (`pg`, or the Databricks SQL connector)
 * and returning rows - the agent, the routes and the UI stay untouched because
 * everything above this file only knows ProductionRepository.
 *
 * Schema: db/schema.sql
 * Selected with: JERVIS_DATA_SOURCE=postgres DATABASE_URL=postgres://...
 */

const WHERE_CLAUSES = [
  ['from', 'i.issue_date >= $from'],
  ['to', 'i.issue_date <= $to'],
  ['shiftId', 'i.shift_id = $shiftId'],
  ['lineId', 'i.line_id = $lineId'],
  ['modelId', 'i.model_id = $modelId'],
  ['errorCode', 'i.error_code = $errorCode'],
  ['partId', 'i.part_id = $partId'],
  ['costCenter', 'i.cost_center = $costCenter'],
  ['checkpointId', 'i.checkpoint_id = $checkpointId'],
  ['severity', 'i.severity = $severity'],
  ['reworkCategoryId', 'i.rework_category_id = $reworkCategoryId'],
  ['status', 'i.status = $status'],
  ['vin', 'i.vin = $vin'],
];

/** Builds the WHERE fragment plus ordered parameter list from a filter. */
export const buildWhere = (filter = {}) => {
  const clauses = [];
  const params = [];
  for (const [key, template] of WHERE_CLAUSES) {
    if (filter[key] === undefined || filter[key] === null || filter[key] === '') continue;
    params.push(filter[key]);
    clauses.push(template.replace(/\$\w+/, `$${params.length}`));
  }
  return {
    text: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
};

const notImplemented = (method) => {
  const error = new Error(
    `PostgresRepository.${method}() is not wired yet. The prototype runs on ` +
      'JERVIS_DATA_SOURCE=memory; set up db/schema.sql and a driver to enable this adapter.',
  );
  error.statusCode = 501;
  throw error;
};

export class PostgresRepository extends ProductionRepository {
  constructor({ connectionString }) {
    super();
    this.connectionString = connectionString;
    this.pool = null; // new Pool({ connectionString })
  }

  async meta() {
    return {
      adapter: 'postgres',
      connected: false,
      note: 'Adapter stub - implement the queries below against db/schema.sql.',
    };
  }

  // SELECT i.* FROM production.issue_events i {where}
  // ORDER BY i.detected_at DESC LIMIT {limit}
  async listIssues() {
    return notImplemented('listIssues');
  }

  // SELECT count(*) FROM production.issue_events i {where}
  async countIssues() {
    return notImplemented('countIssues');
  }

  // SELECT {dimension} AS key, count(*) AS count,
  //        count(DISTINCT i.vin) AS vehicles,
  //        coalesce(sum(i.rework_minutes), 0) AS rework_minutes,
  //        count(*) FILTER (WHERE i.vehicle_removed) AS removed
  // FROM production.issue_events i {where} GROUP BY 1 ORDER BY 2 DESC
  async aggregateIssues() {
    return notImplemented('aggregateIssues');
  }

  // SELECT count(DISTINCT i.vin) AS affected,
  //        count(DISTINCT i.vin) FILTER (WHERE i.rework_minutes > 0) AS reworked,
  //        count(DISTINCT i.vin) FILTER (WHERE i.vehicle_removed) AS removed,
  //        coalesce(sum(i.rework_minutes), 0) AS rework_minutes
  // FROM production.issue_events i {where}
  async vehicleImpact() {
    return notImplemented('vehicleImpact');
  }

  // SELECT * FROM maintenance.tickets i {where} ORDER BY i.opened_at DESC
  async listMaintenance() {
    return notImplemented('listMaintenance');
  }

  // SELECT * FROM telemetry.downtime_events i {where} ORDER BY i.duration_minutes DESC
  async listDowntime() {
    return notImplemented('listDowntime');
  }

  // SELECT i.issue_date AS date, count(*) AS count
  // FROM production.issue_events i {where} GROUP BY 1 ORDER BY 1
  async dailyTrend() {
    return notImplemented('dailyTrend');
  }
}
