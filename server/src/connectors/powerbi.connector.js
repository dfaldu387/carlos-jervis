import { POWERBI_REPORTS } from '../data/catalog.js';
import { getRepository } from '../data/index.js';
import { isLive, resolve_ } from '../integrations/store.js';
import { overlayLiveMeasures } from './powerbi.client.js';

/**
 * Power BI connector.
 *
 * Returns the measures the client's dashboards publish, plus the deep link
 * back to the report. Measures are computed from the active data source by
 * default; when the Power BI connector is configured and enabled with a DAX
 * measures query, the live values from
 * POST /v1.0/myorg/groups/{groupId}/datasets/{datasetId}/executeQueries are
 * overlaid on top, and any value that came back live is marked `live: true`.
 */

const planned = 460; // planned vehicles per line per shift, used for yield math

export const reportsFor = (measure) =>
  POWERBI_REPORTS.filter((report) => report.measures.includes(measure));

/**
 * How people refer to each measure, in both languages, for the
 * "what is the OEE in Power BI" style lookup (tools/dashboards.js).
 */
export const MEASURE_ALIASES = {
  issues_total: ['issues', 'issue count', 'number of issues', 'problems', 'probleme', 'anzahl probleme', 'fehler', 'störungen'],
  vehicles_affected: ['vehicles affected', 'affected vehicles', 'betroffene fahrzeuge', 'fahrzeuge betroffen'],
  vehicles_reworked: ['vehicles reworked', 'reworked vehicles', 'reworked', 'nachgearbeitete fahrzeuge', 'nacharbeit fahrzeuge'],
  vehicles_removed: ['removed from line', 'vehicles removed', 'removed', 'aus der linie genommen', 'entnommene fahrzeuge'],
  rework_minutes: ['rework time', 'rework minutes', 'nacharbeitszeit', 'nacharbeitsminuten'],
  rework_rate: ['rework rate', 'nacharbeitsquote', 'nacharbeitsrate', 'rework share'],
  first_pass_yield: ['first pass yield', 'fpy', 'yield', 'first-pass yield', 'erstdurchlaufquote', 'first pass'],
  oee: ['oee', 'overall equipment effectiveness', 'gesamtanlageneffektivität', 'anlageneffektivität', 'equipment effectiveness'],
  rework_cost: ['rework cost', 'cost of rework', 'nacharbeitskosten', 'kosten'],
};

export const fetchMeasures = async (filter = {}, { includeRestricted = false } = {}) => {
  const repository = getRepository();
  const [issueCount, impact, byRework, downtime] = await Promise.all([
    repository.countIssues(filter),
    repository.vehicleImpact(filter),
    repository.aggregateIssues(filter, 'reworkCategoryId'),
    repository.listDowntime({ ...filter, limit: 1000 }),
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

  // OEE the way the overview report estimates it: availability from the
  // recorded stops against planned run time (8 h per shift), quality from
  // the first pass yield, performance assumed at 100% because the mock has
  // no cycle-time feed. Clearly an estimate, labelled as such.
  const plannedMinutes = 480 * shiftCount * dayCount * lineCount;
  const downtimeMinutes = downtime.reduce((sum, row) => sum + row.durationMinutes, 0);
  const availability = plannedMinutes > 0 ? Math.max(0, 1 - downtimeMinutes / plannedMinutes) : null;
  const oee = availability !== null && firstPassYield !== null ? availability * firstPassYield : null;
  const reworkRate = producedEstimate > 0 ? impact.reworked / producedEstimate : null;

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
    {
      key: 'rework_rate',
      label: 'Rework rate (est.)',
      value: reworkRate,
      format: 'percent',
      report: 'pbi-production-quality',
    },
    {
      key: 'oee',
      label: 'OEE (est.)',
      value: oee,
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

  // Live overlay: when Power BI is configured and enabled with a DAX query,
  // replace the computed values with the published measures. Any failure keeps
  // the computed values, so an answer never claims a live figure it did not get.
  let mode = 'mock';
  let resolvedMeasures = measures;
  if (isLive('powerbi')) {
    const overlay = await overlayLiveMeasures(measures, resolve_('powerbi'));
    resolvedMeasures = overlay.measures;
    mode = overlay.mode;
  }

  return {
    measures: resolvedMeasures,
    mode,
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
