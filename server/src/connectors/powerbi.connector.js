import { POWERBI_REPORTS } from '../data/catalog.js';
import { getRepository } from '../data/index.js';

/**
 * Power BI connector (mock mode).
 *
 * Returns the measures the client's dashboards publish, plus the deep link
 * back to the report. In live mode the same function shape is backed by
 * POST /v1.0/myorg/groups/{groupId}/datasets/{datasetId}/executeQueries.
 */

const planned = 460; // planned vehicles per line per shift, used for yield math

export const reportsFor = (measure) =>
  POWERBI_REPORTS.filter((report) => report.measures.includes(measure));

export const fetchMeasures = async (filter = {}, { includeRestricted = false } = {}) => {
  const repository = getRepository();
  const [issueCount, impact, byRework] = await Promise.all([
    repository.countIssues(filter),
    repository.vehicleImpact(filter),
    repository.aggregateIssues(filter, 'reworkCategoryId'),
  ]);

  const shiftCount = filter.shiftId ? 1 : 3;
  const dayCount = filter.from && filter.to
    ? Math.max(
        1,
        Math.round(
          (new Date(`${filter.to}T00:00:00Z`) - new Date(`${filter.from}T00:00:00Z`)) / 86400000,
        ) + 1,
      )
    : 1;
  const lineCount = filter.lineId ? 1 : 4;
  const producedEstimate = planned * shiftCount * dayCount * lineCount;

  const firstPassYield =
    producedEstimate > 0
      ? Math.max(0, 1 - impact.affected / producedEstimate)
      : null;

  const measures = [
    {
      key: 'issues_total',
      label: 'Issues recorded',
      value: issueCount,
      format: 'integer',
      report: 'pbi-production-quality',
    },
    {
      key: 'vehicles_affected',
      label: 'Vehicles affected',
      value: impact.affected,
      format: 'integer',
      report: 'pbi-production-quality',
    },
    {
      key: 'vehicles_reworked',
      label: 'Vehicles reworked',
      value: impact.reworked,
      format: 'integer',
      report: 'pbi-rework-tracking',
    },
    {
      key: 'vehicles_removed',
      label: 'Removed from line',
      value: impact.removed,
      format: 'integer',
      report: 'pbi-rework-tracking',
    },
    {
      key: 'rework_minutes',
      label: 'Rework time',
      value: impact.reworkMinutes,
      format: 'minutes',
      report: 'pbi-rework-tracking',
    },
    {
      key: 'first_pass_yield',
      label: 'First pass yield (est.)',
      value: firstPassYield,
      format: 'percent',
      report: 'pbi-production-quality',
    },
  ];

  if (includeRestricted) {
    // Cost figures live in the restricted Finance workspace report.
    const reworkCost = Math.round(impact.reworkMinutes * 1.85);
    measures.push({
      key: 'rework_cost',
      label: 'Estimated rework cost',
      value: reworkCost,
      format: 'currency',
      report: 'pbi-cost-center',
      restricted: true,
    });
  }

  return {
    measures,
    reworkBreakdown: byRework,
    reports: POWERBI_REPORTS.filter((report) => includeRestricted || !report.restricted).map(
      (report) => ({
        id: report.id,
        name: report.name,
        workspace: report.workspace,
        url: report.url,
      }),
    ),
  };
};
