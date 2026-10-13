import { getRepository } from '../../data/index.js';
import { DIMENSION_LABELS } from '../../data/repository.js';
import { labelFor } from '../labels.js';

/**
 * Retrieval tools over the production warehouse (Databricks in live mode).
 * Each tool returns the data plus the citation the answer will carry.
 */

export const searchIssues = {
  id: 'issues.search',
  source: 'databricks',
  label: 'Issue search',
  description: 'Retrieve individual production issues matching the question filters.',
  async run({ filter, limit = 8 }) {
    const repository = getRepository();
    const rows = await repository.listIssues({ ...filter, limit });
    const total = await repository.countIssues(filter);
    return {
      data: { rows, total, returned: rows.length },
      citation: {
        source: 'databricks',
        object: 'prod_quality.issue_events',
        detail: `${total} matching issue events`,
      },
    };
  },
};

export const aggregateIssues = {
  id: 'issues.aggregate',
  source: 'databricks',
  label: 'Issue aggregation',
  description: 'Group issues by a dimension such as error code, line, model or checkpoint.',
  async run({ filter, dimension = 'errorCode', limit = 6 }) {
    const repository = getRepository();
    const buckets = await repository.aggregateIssues({ ...filter, limit }, dimension);
    return {
      data: {
        dimension,
        dimensionLabel: DIMENSION_LABELS[dimension] ?? dimension,
        buckets: buckets.map((bucket) => ({ ...bucket, label: labelFor(dimension, bucket.key) })),
      },
      citation: {
        source: 'databricks',
        object: 'prod_quality.issue_events',
        detail: `grouped by ${DIMENSION_LABELS[dimension] ?? dimension}`,
      },
    };
  },
};

export const vehicleImpact = {
  id: 'issues.vehicleImpact',
  source: 'databricks',
  label: 'Vehicle impact',
  description: 'Count affected, reworked and removed vehicles.',
  async run({ filter }) {
    const repository = getRepository();
    const impact = await repository.vehicleImpact(filter);
    return {
      data: impact,
      citation: {
        source: 'databricks',
        object: 'prod_quality.issue_events',
        detail: `${impact.affected} distinct vehicles`,
      },
    };
  },
};

export const reworkBreakdown = {
  id: 'issues.rework',
  source: 'databricks',
  label: 'Rework breakdown',
  description: 'Split issues by rework category, including vehicles removed from the line.',
  async run({ filter }) {
    const repository = getRepository();
    const buckets = await repository.aggregateIssues(filter, 'reworkCategoryId');
    const impact = await repository.vehicleImpact(filter);
    return {
      data: {
        impact,
        buckets: buckets.map((bucket) => ({
          ...bucket,
          label: labelFor('reworkCategoryId', bucket.key),
        })),
      },
      citation: {
        source: 'databricks',
        object: 'prod_quality.rework_records',
        detail: `${impact.reworked} vehicles with rework`,
      },
    };
  },
};

export const issueTrend = {
  id: 'issues.trend',
  source: 'databricks',
  label: 'Trend',
  description: 'Daily issue counts across the requested period.',
  async run({ filter }) {
    const repository = getRepository();
    const series = await repository.dailyTrend(filter);
    const values = series.map((point) => point.count);
    const average = values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
      : 0;
    return {
      data: {
        series,
        average,
        peak: series.reduce((best, point) => (!best || point.count > best.count ? point : best), null),
      },
      citation: {
        source: 'databricks',
        object: 'prod_quality.issue_events',
        detail: `${series.length} days in range`,
      },
    };
  },
};

export const shiftBreakdown = {
  id: 'issues.byShift',
  source: 'databricks',
  label: 'Shift breakdown',
  description: 'Issue counts per production shift (06:00-14:00, 14:00-22:00, 22:00-06:00).',
  async run({ filter }) {
    const repository = getRepository();
    const buckets = await repository.aggregateIssues(filter, 'shiftId');
    return {
      data: {
        buckets: buckets.map((bucket) => ({ ...bucket, label: labelFor('shiftId', bucket.key) })),
      },
      citation: {
        source: 'databricks',
        object: 'prod_quality.issue_events',
        detail: 'grouped by shift',
      },
    };
  },
};
