/**
 * The production-data contract.
 *
 * Every retrieval tool in the agent talks to this interface and nothing else.
 * The prototype ships the in-memory adapter; the real integration (Databricks
 * SQL warehouse, or a Postgres/serving layer in front of it) implements the
 * same methods and is selected with JERVIS_DATA_SOURCE. No agent or route code
 * changes when that happens - see docs/DATA-LAYER.md.
 *
 * Filter shape accepted by every method:
 *   {
 *     from, to,            // ISO dates, inclusive
 *     shiftId, lineId, modelId, errorCode, partId,
 *     costCenter, checkpointId, severity, reworkCategoryId,
 *     status, vin,
 *     limit
 *   }
 */
export class ProductionRepository {
  /** @returns {Promise<object>} dataset metadata: reference date, row counts. */
  async meta() {
    throw new Error('meta() not implemented');
  }

  /** @returns {Promise<object[]>} raw issue rows matching the filter. */
  async listIssues() {
    throw new Error('listIssues() not implemented');
  }

  /** @returns {Promise<number>} */
  async countIssues() {
    throw new Error('countIssues() not implemented');
  }

  /**
   * Group issues by one dimension.
   * @param {object} filter
   * @param {'date'|'shiftId'|'lineId'|'modelId'|'errorCode'|'partId'|'costCenter'|'checkpointId'|'severity'|'reworkCategoryId'|'category'|'status'} dimension
   * @returns {Promise<Array<{key: string, count: number, vehicles: number, reworkMinutes: number}>>}
   */
  async aggregateIssues() {
    throw new Error('aggregateIssues() not implemented');
  }

  /** @returns {Promise<{affected: number, reworked: number, removed: number, reworkMinutes: number}>} */
  async vehicleImpact() {
    throw new Error('vehicleImpact() not implemented');
  }

  /** @returns {Promise<object[]>} Integral Portal maintenance tickets. */
  async listMaintenance() {
    throw new Error('listMaintenance() not implemented');
  }

  /** @returns {Promise<object[]>} MQTT downtime events. */
  async listDowntime() {
    throw new Error('listDowntime() not implemented');
  }

  /** @returns {Promise<Array<{date: string, count: number}>>} */
  async dailyTrend() {
    throw new Error('dailyTrend() not implemented');
  }
}

export const DIMENSION_LABELS = {
  date: 'Date',
  shiftId: 'Shift',
  lineId: 'Production line',
  modelId: 'Vehicle model',
  errorCode: 'Error code',
  partId: 'Part',
  costCenter: 'Cost center',
  checkpointId: 'Checkpoint',
  severity: 'Severity',
  reworkCategoryId: 'Rework category',
  category: 'Issue category',
  status: 'Status',
};
