import { ProductionRepository } from '../repository.js';
import { buildDataset } from '../seed.js';

const matches = (row, filter) => {
  if (filter.from && row.date < filter.from) return false;
  if (filter.to && row.date > filter.to) return false;
  if (filter.shiftId && row.shiftId !== filter.shiftId) return false;
  if (filter.lineId && row.lineId !== filter.lineId) return false;
  if (filter.modelId && row.modelId !== filter.modelId) return false;
  if (filter.errorCode && row.errorCode !== filter.errorCode) return false;
  if (filter.partId && row.partId !== filter.partId) return false;
  if (filter.costCenter && row.costCenter !== filter.costCenter) return false;
  if (filter.checkpointId && row.checkpointId !== filter.checkpointId) return false;
  if (filter.severity && row.severity !== filter.severity) return false;
  if (filter.reworkCategoryId && row.reworkCategoryId !== filter.reworkCategoryId) return false;
  if (filter.status && row.status !== filter.status) return false;
  if (filter.vin && row.vin !== filter.vin) return false;
  return true;
};

/**
 * In-memory adapter over the seeded synthetic warehouse.
 *
 * Stands in for the Databricks SQL warehouse during the prototype phase. The
 * filtering below is the same predicate set a WHERE clause would carry, which
 * keeps the swap to a real query engine mechanical.
 */
export class MemoryRepository extends ProductionRepository {
  constructor() {
    super();
    this.dataset = buildDataset();
  }

  async meta() {
    return {
      adapter: 'memory',
      referenceDate: this.dataset.referenceDate,
      daysOfHistory: this.dataset.daysOfHistory,
      generatedAt: this.dataset.generatedAt,
      counts: {
        issues: this.dataset.issues.length,
        vehicles: this.dataset.vehicles.length,
        maintenanceTickets: this.dataset.maintenanceTickets.length,
        downtimeEvents: this.dataset.downtimeEvents.length,
      },
    };
  }

  async listIssues(filter = {}) {
    const rows = this.dataset.issues
      .filter((row) => matches(row, filter))
      .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async countIssues(filter = {}) {
    return this.dataset.issues.filter((row) => matches(row, filter)).length;
  }

  async aggregateIssues(filter = {}, dimension = 'errorCode') {
    const rows = this.dataset.issues.filter((row) => matches(row, filter));
    const buckets = new Map();

    for (const row of rows) {
      const key = String(row[dimension] ?? 'unknown');
      const bucket = buckets.get(key) ?? {
        key,
        count: 0,
        vehicles: new Set(),
        reworkMinutes: 0,
        removed: 0,
      };
      bucket.count += 1;
      bucket.vehicles.add(row.vin);
      bucket.reworkMinutes += row.reworkMinutes;
      if (row.vehicleRemoved) bucket.removed += 1;
      buckets.set(key, bucket);
    }

    const aggregated = [...buckets.values()]
      .map((bucket) => ({
        key: bucket.key,
        count: bucket.count,
        vehicles: bucket.vehicles.size,
        reworkMinutes: bucket.reworkMinutes,
        removed: bucket.removed,
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    return filter.limit ? aggregated.slice(0, filter.limit) : aggregated;
  }

  async vehicleImpact(filter = {}) {
    const rows = this.dataset.issues.filter((row) => matches(row, filter));
    const affected = new Set();
    const reworked = new Set();
    const removed = new Set();
    let reworkMinutes = 0;

    for (const row of rows) {
      affected.add(row.vin);
      if (row.reworkMinutes > 0) reworked.add(row.vin);
      if (row.vehicleRemoved) removed.add(row.vin);
      reworkMinutes += row.reworkMinutes;
    }

    return {
      affected: affected.size,
      reworked: reworked.size,
      removed: removed.size,
      reworkMinutes,
    };
  }

  async listMaintenance(filter = {}) {
    const rows = this.dataset.maintenanceTickets
      .filter((row) => matches(row, filter))
      .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async listDowntime(filter = {}) {
    const rows = this.dataset.downtimeEvents
      .filter((row) => matches(row, filter))
      .sort((a, b) => b.durationMinutes - a.durationMinutes);
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async dailyTrend(filter = {}) {
    const buckets = new Map();
    for (const row of this.dataset.issues.filter((entry) => matches(entry, filter))) {
      buckets.set(row.date, (buckets.get(row.date) ?? 0) + 1);
    }
    return [...buckets.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
