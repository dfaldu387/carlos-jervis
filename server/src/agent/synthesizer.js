import { INTENTS, describeDate, describeShift } from './nlu.js';
import { SOURCE_LABELS } from '../connectors/index.js';
import { EXTERNAL_APPS } from '../data/catalog.js';
import { formatRange } from '../utils/dates.js';
import { GREETING_PROMPT, currentHour, greetingFor } from './greeting.js';
import { labelFor } from './labels.js';
import { DIMENSION_LABELS } from '../data/repository.js';

/**
 * Answer composition.
 *
 * Takes the facts the tools returned and builds one consolidated answer:
 * headline, narrative, KPI tiles, tables, chart series, source citations and
 * follow-up questions. Numbers are only ever copied from retrieved facts -
 * nothing here invents a figure, which is what keeps the optional LLM pass in
 * llm.js safe to switch on.
 */

const plural = (count, singular, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export const formatMinutes = (minutes) => {
  if (!minutes || minutes <= 0) return '0 min';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
};

const topBucketText = (buckets, dimension, limit = 3) =>
  buckets
    .slice(0, limit)
    .map((bucket) => `${bucket.label ?? labelFor(dimension, bucket.key)} (${bucket.count})`)
    .join(', ');

const metric = (key, label, value, format, source, extra = {}) => ({
  key,
  label,
  value,
  format,
  source,
  ...extra,
});

const bucketTable = (id, title, dimension, buckets, source) => ({
  id,
  title,
  source,
  columns: [
    { key: 'label', label: DIMENSION_LABELS[dimension] ?? 'Dimension', align: 'left' },
    { key: 'count', label: 'Issues', align: 'right', format: 'integer' },
    { key: 'vehicles', label: 'Vehicles', align: 'right', format: 'integer' },
    { key: 'reworkMinutes', label: 'Rework time', align: 'right', format: 'minutes' },
  ],
  rows: buckets.map((bucket) => ({
    label: bucket.label ?? labelFor(dimension, bucket.key),
    count: bucket.count,
    vehicles: bucket.vehicles,
    reworkMinutes: bucket.reworkMinutes,
  })),
});

const issueTable = (rows) => ({
  id: 'issue-records',
  title: 'Representative issue records',
  source: 'databricks',
  columns: [
    { key: 'detectedAt', label: 'Detected', align: 'left', format: 'time' },
    { key: 'errorCode', label: 'Code', align: 'left' },
    { key: 'symptom', label: 'Symptom', align: 'left' },
    { key: 'line', label: 'Line', align: 'left' },
    { key: 'model', label: 'Model', align: 'left' },
    { key: 'severity', label: 'Severity', align: 'left', format: 'severity' },
    { key: 'rework', label: 'Rework', align: 'left' },
  ],
  rows: rows.map((row) => ({
    detectedAt: row.detectedAt,
    errorCode: row.errorCode,
    symptom: row.symptom,
    line: labelFor('lineId', row.lineId),
    model: labelFor('modelId', row.modelId),
    severity: row.severity,
    rework: labelFor('reworkCategoryId', row.reworkCategoryId),
    vin: row.vin,
    status: row.status,
  })),
});

const periodPhrase = (interpretation) => {
  const { resolvedTimeframe, entities } = interpretation;
  const base =
    resolvedTimeframe.from === resolvedTimeframe.to
      ? describeDate(resolvedTimeframe.from)
      : formatRange(resolvedTimeframe);
  return entities.shiftId ? `${base}, ${describeShift(entities.shiftId)}` : base;
};

const scopePhrase = (interpretation) => {
  const { entities } = interpretation;
  const parts = [];
  if (entities.line) parts.push(entities.line.name);
  if (entities.model) parts.push(entities.model.name);
  if (entities.errorCodeEntry) parts.push(`${entities.errorCodeEntry.code} ${entities.errorCodeEntry.description}`);
  if (entities.part) parts.push(entities.part.name);
  if (entities.checkpoint) parts.push(entities.checkpoint.name);
  if (entities.severity) parts.push(`${entities.severity} severity`);
  return parts.length > 0 ? ` for ${parts.join(', ')}` : '';
};

const fact = (facts, toolId) => facts.find((entry) => entry.tool === toolId)?.data ?? null;

const measureValue = (measures, key) =>
  measures?.measures?.find((entry) => entry.key === key)?.value ?? null;

const kpiTiles = (facts) => {
  const measures = fact(facts, 'powerbi.measures');
  const impact = fact(facts, 'issues.vehicleImpact') ?? fact(facts, 'issues.rework')?.impact;
  const trend = fact(facts, 'issues.trend');
  const tiles = [];

  const issueTotal = measureValue(measures, 'issues_total');
  if (issueTotal !== null) {
    tiles.push(
      metric('issues_total', 'Issues recorded', issueTotal, 'integer', 'powerbi', {
        trend: trend?.series?.map((point) => point.count) ?? null,
      }),
    );
  }

  if (impact) {
    tiles.push(metric('vehicles_affected', 'Vehicles affected', impact.affected, 'integer', 'databricks'));
    tiles.push(metric('vehicles_reworked', 'Vehicles reworked', impact.reworked, 'integer', 'databricks'));
    tiles.push(
      metric('vehicles_removed', 'Removed from line', impact.removed, 'integer', 'databricks', {
        tone: impact.removed > 0 ? 'warning' : 'neutral',
      }),
    );
    tiles.push(metric('rework_minutes', 'Rework time', impact.reworkMinutes, 'minutes', 'databricks'));
  }

  const yieldValue = measureValue(measures, 'first_pass_yield');
  if (yieldValue !== null) {
    tiles.push(metric('first_pass_yield', 'First pass yield (est.)', yieldValue, 'percent', 'powerbi'));
  }

  const cost = measureValue(measures, 'rework_cost');
  if (cost !== null) {
    tiles.push(metric('rework_cost', 'Estimated rework cost', cost, 'currency', 'powerbi', { restricted: true }));
  }

  const downtime = fact(facts, 'telemetry.downtime');
  if (downtime) {
    tiles.push(metric('downtime_minutes', 'Recorded downtime', downtime.totalMinutes, 'minutes', 'mqtt'));
  }

  const maintenance = fact(facts, 'maintenance.tickets');
  if (maintenance) {
    tiles.push(
      metric('maintenance_open', 'Open maintenance tickets', maintenance.open, 'integer', 'integral_portal', {
        tone: maintenance.open > 0 ? 'warning' : 'good',
      }),
    );
  }

  return tiles;
};

const FOLLOW_UPS = {
  [INTENTS.ISSUE_SUMMARY]: [
    'Which vehicle models were affected?',
    'How many vehicles were reworked?',
    'Which checkpoints detected the issues?',
  ],
  [INTENTS.DAILY_SUMMARY]: [
    'Break that down by shift',
    'Which production line had the most issues?',
    'Show the maintenance work for the same day',
  ],
  [INTENTS.SHIFT_SUMMARY]: [
    'What problems did the late shift have?',
    'Which parts were involved?',
    'How much downtime was recorded?',
  ],
  [INTENTS.TOP_ERROR_CODES]: [
    'Which parts are involved in E-4120?',
    'Which models were affected?',
    'Show the trend over the last 7 days',
  ],
  [INTENTS.REWORK_COUNT]: [
    'Which vehicles were removed from the line?',
    'What is the rework cost impact?',
    'Which line produced the most rework?',
  ],
  [INTENTS.DOWNTIME]: [
    'What maintenance tickets were opened?',
    'Which line stopped the longest?',
    'What problems happened during the stops?',
  ],
};

const defaultFollowUps = [
  'What problems did we have on Friday?',
  'Summarize the early shift yesterday',
  'Which error codes occurred this week?',
];

/**
 * @param {object} args
 * @param {object} args.interpretation
 * @param {Array<{tool: string, data: object, citation: object}>} args.facts
 * @param {object} args.access role + permissions
 */
export const compose = ({ interpretation, facts, access }) => {
  const period = periodPhrase(interpretation);
  const scope = scopePhrase(interpretation);
  const intent = interpretation.intent;

  const narrative = [];
  const bullets = [];
  const tables = [];
  const charts = [];
  const links = [];

  const measures = fact(facts, 'powerbi.measures');
  const impact = fact(facts, 'issues.vehicleImpact') ?? fact(facts, 'issues.rework')?.impact;
  const issueTotal = measureValue(measures, 'issues_total');

  const aggregates = facts.filter((entry) => entry.tool === 'issues.aggregate');
  const byDimension = (dimension) =>
    aggregates.find((entry) => entry.data.dimension === dimension)?.data ?? null;

  const errorCodes = byDimension('errorCode');
  const lines = byDimension('lineId');
  const models = byDimension('modelId');
  const parts = byDimension('partId');
  const checkpoints = byDimension('checkpointId');
  const costCenters = byDimension('costCenter');
  const shifts = fact(facts, 'issues.byShift');
  const rework = fact(facts, 'issues.rework');
  const trend = fact(facts, 'issues.trend');
  const maintenance = fact(facts, 'maintenance.tickets');
  const downtime = fact(facts, 'telemetry.downtime');
  const issues = fact(facts, 'issues.search');
  const reports = fact(facts, 'powerbi.reports');

  const total = issueTotal ?? issues?.total ?? errorCodes?.buckets?.reduce((sum, b) => sum + b.count, 0) ?? 0;

  let headline;

  switch (intent) {
    case INTENTS.GREETING:
      // Same opening the voice loop speaks on wake, so "hey Jervis" and a
      // typed "hello" are answered with one voice.
      headline = greetingFor(currentHour());
      narrative.push(
        `${GREETING_PROMPT} I can answer questions about production issues, rework, shifts, lines, vehicle models, error codes, parts, checkpoints, maintenance and downtime, and I will tell you which system each figure came from.`,
      );
      break;

    case INTENTS.CAPABILITIES:
      headline = 'What I can answer today';
      narrative.push(
        'I combine the production issue history, the Power BI measures, the Integral Portal maintenance records and the MQTT downtime signals into one answer, and cite each source.',
      );
      bullets.push(
        { text: 'Production problems for a day, a shift, a line or a vehicle model' },
        { text: 'Error codes, symptoms, parts, cost centers and checkpoints behind the issues' },
        { text: 'Rework counts, including vehicles removed from the line' },
        { text: 'Daily and shift summaries over the 06:00-14:00, 14:00-22:00 and 22:00-06:00 periods' },
        { text: 'Maintenance tickets and recorded downtime for the same period' },
        { text: 'A link back to the Power BI report or application that owns the figures' },
      );
      break;

    case INTENTS.UNKNOWN:
      headline = 'I need a little more to go on';
      narrative.push(
        `I could not identify what to retrieve for that question. Name a period, a line, a shift, a model or an error code and I will investigate - for example "what problems did we have on Friday on Final Assembly 1?".`,
      );
      break;

    case INTENTS.DAILY_SUMMARY:
    case INTENTS.SHIFT_SUMMARY: {
      headline = `${total === 0 ? 'No issues' : plural(total, 'issue')} recorded on ${period}${scope}`;
      if (total === 0) {
        narrative.push(`Nothing was recorded for ${period}${scope} in the production issue history.`);
        break;
      }
      narrative.push(
        `On ${period}${scope} the production issue history holds ${plural(total, 'issue event')}, affecting ${plural(impact?.affected ?? 0, 'vehicle')}. ${impact?.removed ?? 0} of them were taken off the line and ${formatMinutes(impact?.reworkMinutes ?? 0)} of rework was booked.`,
      );
      if (errorCodes?.buckets?.length) {
        narrative.push(`The dominant problems were ${topBucketText(errorCodes.buckets, 'errorCode')}.`);
      }
      if (shifts?.buckets?.length && intent === INTENTS.DAILY_SUMMARY) {
        const worst = shifts.buckets[0];
        bullets.push({
          text: `Heaviest shift: ${worst.label} with ${plural(worst.count, 'issue')}`,
          tone: 'warning',
        });
      }
      if (lines?.buckets?.length) {
        bullets.push({ text: `Most affected line: ${lines.buckets[0].label} (${lines.buckets[0].count} issues)` });
      }
      if (downtime?.totalMinutes) {
        bullets.push({
          text: `${formatMinutes(downtime.totalMinutes)} of downtime across ${plural(downtime.rows.length, 'stop')} (MQTT)`,
        });
      }
      if (maintenance?.total) {
        bullets.push({
          text: `${plural(maintenance.total, 'maintenance ticket')} in the Integral Portal, ${maintenance.open} still open`,
          tone: maintenance.open > 0 ? 'warning' : 'good',
        });
      }
      break;
    }

    case INTENTS.TOP_ERROR_CODES: {
      const count = errorCodes?.buckets?.length ?? 0;
      headline = `${count} distinct error ${count === 1 ? 'code' : 'codes'} on ${period}${scope}`;
      if (count === 0) {
        narrative.push(`No error codes were recorded for ${period}${scope}.`);
        break;
      }
      narrative.push(
        `${plural(total, 'issue')} on ${period}${scope} map to ${count} distinct error ${count === 1 ? 'code' : 'codes'}. The most frequent were ${topBucketText(errorCodes.buckets, 'errorCode')}.`,
      );
      break;
    }

    case INTENTS.AFFECTED_MODELS: {
      const count = models?.buckets?.length ?? 0;
      headline = `${count} vehicle ${count === 1 ? 'model' : 'models'} affected on ${period}${scope}`;
      if (count === 0) {
        narrative.push(`No vehicle models were affected for ${period}${scope}.`);
        break;
      }
      narrative.push(
        `${topBucketText(models.buckets, 'modelId', 5)} - ${plural(impact?.affected ?? 0, 'vehicle')} in total${scope}.`,
      );
      if (errorCodes?.buckets?.length) {
        narrative.push(`The issues behind those models were mainly ${topBucketText(errorCodes.buckets, 'errorCode')}.`);
      }
      break;
    }

    case INTENTS.LINE_ISSUES: {
      const count = lines?.buckets?.length ?? 0;
      headline =
        count > 0
          ? `${lines.buckets[0].label} had the most issues on ${period}`
          : `No line activity recorded on ${period}`;
      if (count === 0) {
        narrative.push(`No issues were recorded on any line for ${period}${scope}.`);
        break;
      }
      narrative.push(
        `Across ${period}${scope}, ${topBucketText(lines.buckets, 'lineId', 4)}. ${lines.buckets[0].label} leads with ${plural(lines.buckets[0].count, 'issue')} and ${formatMinutes(lines.buckets[0].reworkMinutes)} of rework.`,
      );
      if (downtime?.byLine?.length) {
        bullets.push({
          text: `Longest downtime: ${downtime.byLine[0].label}, ${formatMinutes(downtime.byLine[0].minutes)}`,
        });
      }
      break;
    }

    case INTENTS.PARTS_INVOLVED: {
      const count = parts?.buckets?.length ?? 0;
      headline = `${count} ${count === 1 ? 'part' : 'parts'} involved on ${period}${scope}`;
      if (count === 0) {
        narrative.push(`No parts were recorded against issues for ${period}${scope}.`);
        break;
      }
      narrative.push(
        `The components appearing most often were ${topBucketText(parts.buckets, 'partId', 4)}.`,
      );
      if (errorCodes?.buckets?.length) {
        narrative.push(`They are associated with ${topBucketText(errorCodes.buckets, 'errorCode', 2)}.`);
      }
      break;
    }

    case INTENTS.VEHICLE_COUNT: {
      headline = `${impact?.affected ?? 0} vehicles affected on ${period}${scope}`;
      narrative.push(
        `${plural(impact?.affected ?? 0, 'vehicle')} were affected on ${period}${scope}. ${impact?.reworked ?? 0} needed rework and ${impact?.removed ?? 0} were removed from the line.`,
      );
      if (models?.buckets?.length) {
        narrative.push(`By model: ${topBucketText(models.buckets, 'modelId', 5)}.`);
      }
      break;
    }

    case INTENTS.REWORK_COUNT: {
      headline = `${impact?.reworked ?? 0} vehicles reworked on ${period}${scope}`;
      narrative.push(
        `${plural(impact?.reworked ?? 0, 'vehicle')} went through rework on ${period}${scope}, of which ${impact?.removed ?? 0} were removed from the line. Booked rework time was ${formatMinutes(impact?.reworkMinutes ?? 0)}.`,
      );
      if (rework?.buckets?.length) {
        narrative.push(`By category: ${topBucketText(rework.buckets, 'reworkCategoryId', 5)}.`);
      }
      break;
    }

    case INTENTS.CHECKPOINT_DETECTION: {
      const count = checkpoints?.buckets?.length ?? 0;
      headline = `${count} ${count === 1 ? 'checkpoint' : 'checkpoints'} detected issues on ${period}${scope}`;
      if (count === 0) {
        narrative.push(`No checkpoint detections were recorded for ${period}${scope}.`);
        break;
      }
      narrative.push(`Detections came from ${topBucketText(checkpoints.buckets, 'checkpointId', 5)}.`);
      break;
    }

    case INTENTS.COST_CENTER_IMPACT: {
      const count = costCenters?.buckets?.length ?? 0;
      headline = `Cost center impact for ${period}${scope}`;
      if (!access.permissions.includes('finance:read')) {
        narrative.push(
          'Cost figures sit in the restricted Finance workspace report. Your role can see the issue distribution across cost centers, but not the monetary values.',
        );
      }
      if (count > 0) {
        narrative.push(`Issues distributed across ${topBucketText(costCenters.buckets, 'costCenter', 5)}.`);
      }
      narrative.push(`Rework effort behind those issues totals ${formatMinutes(impact?.reworkMinutes ?? 0)}.`);
      break;
    }

    case INTENTS.MAINTENANCE_STATUS: {
      headline = `${maintenance?.total ?? 0} maintenance tickets on ${period}${scope}`;
      narrative.push(
        `The Integral Portal holds ${plural(maintenance?.total ?? 0, 'ticket')} for ${period}${scope}; ${maintenance?.open ?? 0} are still open.`,
      );
      if (downtime?.totalMinutes) {
        narrative.push(
          `Telemetry recorded ${formatMinutes(downtime.totalMinutes)} of downtime across ${plural(downtime.rows.length, 'stop')} in the same window.`,
        );
      }
      break;
    }

    case INTENTS.DOWNTIME: {
      headline = `${formatMinutes(downtime?.totalMinutes ?? 0)} of downtime on ${period}${scope}`;
      narrative.push(
        `${plural(downtime?.rows?.length ?? 0, 'stop event')} were published to the broker for ${period}${scope}, totalling ${formatMinutes(downtime?.totalMinutes ?? 0)}.`,
      );
      if (downtime?.byLine?.length) {
        narrative.push(
          `By line: ${downtime.byLine.map((entry) => `${entry.label} ${formatMinutes(entry.minutes)}`).join(', ')}.`,
        );
      }
      if (maintenance?.total) {
        bullets.push({ text: `${plural(maintenance.total, 'maintenance ticket')} booked in the same period` });
      }
      break;
    }

    case INTENTS.TREND: {
      headline = `Issue trend for ${formatRange(interpretation.resolvedTimeframe)}${scope}`;
      narrative.push(
        `Across ${trend?.series?.length ?? 0} days the average is ${trend?.average ?? 0} issues per day${trend?.peak ? `, peaking at ${trend.peak.count} on ${trend.peak.date}` : ''}.`,
      );
      if (errorCodes?.buckets?.length) {
        narrative.push(`The trend is driven mainly by ${topBucketText(errorCodes.buckets, 'errorCode', 2)}.`);
      }
      break;
    }

    case INTENTS.DASHBOARD_LOOKUP: {
      headline = `${reports?.reports?.length ?? 0} Power BI reports cover this`;
      narrative.push(
        'Power BI stays the system of record. These are the reports that own the figures, with the current headline values read through the API.',
      );
      if (reports?.hiddenCount) {
        bullets.push({
          text: `${reports.hiddenCount} report(s) hidden for your role`,
          tone: 'warning',
        });
      }
      break;
    }

    case INTENTS.ISSUE_SUMMARY:
    default: {
      headline = `${total === 0 ? 'No problems' : plural(total, 'problem')} recorded on ${period}${scope}`;
      if (total === 0) {
        narrative.push(`Nothing was recorded for ${period}${scope}.`);
        break;
      }
      narrative.push(
        `On ${period}${scope} there were ${plural(total, 'issue event')} affecting ${plural(impact?.affected ?? 0, 'vehicle')}. ${impact?.removed ?? 0} vehicles were removed from the line and ${formatMinutes(impact?.reworkMinutes ?? 0)} of rework was booked.`,
      );
      if (errorCodes?.buckets?.length) {
        const top = errorCodes.buckets[0];
        narrative.push(
          `The biggest contributor was ${top.label} with ${plural(top.count, 'occurrence')}; the full picture is ${topBucketText(errorCodes.buckets, 'errorCode', 4)}.`,
        );
      }
      if (lines?.buckets?.length) {
        bullets.push({ text: `Most affected line: ${lines.buckets[0].label} (${lines.buckets[0].count} issues)` });
      }
      if (impact?.removed) {
        bullets.push({ text: `${plural(impact.removed, 'vehicle')} removed from the line`, tone: 'warning' });
      }
      break;
    }
  }

  // ---- tables & charts -----------------------------------------------------
  if (errorCodes?.buckets?.length) {
    tables.push(bucketTable('by-error-code', 'Issues by error code', 'errorCode', errorCodes.buckets, 'databricks'));
    charts.push({
      id: 'chart-error-code',
      title: 'Issues by error code',
      type: 'bar',
      source: 'databricks',
      points: errorCodes.buckets.map((bucket) => ({ label: bucket.key, value: bucket.count, detail: bucket.label })),
    });
  }
  if (shifts?.buckets?.length) {
    tables.push(bucketTable('by-shift', 'Issues by shift', 'shiftId', shifts.buckets, 'databricks'));
    charts.push({
      id: 'chart-shift',
      title: 'Issues by shift',
      type: 'bar',
      source: 'databricks',
      points: shifts.buckets.map((bucket) => ({ label: bucket.key, value: bucket.count, detail: bucket.label })),
    });
  }
  if (lines?.buckets?.length) {
    tables.push(bucketTable('by-line', 'Issues by production line', 'lineId', lines.buckets, 'databricks'));
    charts.push({
      id: 'chart-production-line',
      title: 'Issues by production line',
      type: 'bar',
      source: 'databricks',
      points: lines.buckets.map((bucket) => ({ label: bucket.key, value: bucket.count, detail: bucket.label })),
    });
  }
  if (models?.buckets?.length) {
    tables.push(bucketTable('by-model', 'Issues by vehicle model', 'modelId', models.buckets, 'databricks'));
  }
  if (parts?.buckets?.length) {
    tables.push(bucketTable('by-part', 'Issues by part', 'partId', parts.buckets, 'databricks'));
  }
  if (checkpoints?.buckets?.length) {
    tables.push(bucketTable('by-checkpoint', 'Detections by checkpoint', 'checkpointId', checkpoints.buckets, 'databricks'));
  }
  if (costCenters?.buckets?.length) {
    tables.push(bucketTable('by-cost-center', 'Issues by cost center', 'costCenter', costCenters.buckets, 'databricks'));
  }
  if (rework?.buckets?.length) {
    tables.push(bucketTable('by-rework', 'Rework categories', 'reworkCategoryId', rework.buckets, 'databricks'));
  }
  if (trend?.series?.length) {
    charts.push({
      id: 'chart-trend',
      title: 'Issues per day',
      type: 'line',
      source: 'databricks',
      points: trend.series.map((point) => ({ label: point.date, value: point.count })),
    });
  }
  if (issues?.rows?.length) {
    tables.push(issueTable(issues.rows));
  }
  if (maintenance?.rows?.length) {
    tables.push({
      id: 'maintenance',
      title: 'Maintenance tickets (Integral Portal)',
      source: 'integral_portal',
      columns: [
        { key: 'id', label: 'Ticket', align: 'left' },
        { key: 'assetName', label: 'Asset', align: 'left' },
        { key: 'line', label: 'Line', align: 'left' },
        { key: 'description', label: 'Work', align: 'left' },
        { key: 'priority', label: 'Priority', align: 'left' },
        { key: 'status', label: 'Status', align: 'left', format: 'status' },
      ],
      rows: maintenance.rows.map((row) => ({
        id: row.id,
        assetName: row.assetName,
        line: labelFor('lineId', row.lineId),
        description: row.description,
        priority: row.priority,
        status: row.status,
      })),
    });
  }
  if (downtime?.rows?.length) {
    tables.push({
      id: 'downtime',
      title: 'Downtime events (MQTT)',
      source: 'mqtt',
      columns: [
        { key: 'line', label: 'Line', align: 'left' },
        { key: 'topic', label: 'Topic', align: 'left' },
        { key: 'reason', label: 'Reason', align: 'left' },
        { key: 'durationMinutes', label: 'Duration', align: 'right', format: 'minutes' },
      ],
      rows: downtime.rows.map((row) => ({
        line: labelFor('lineId', row.lineId),
        topic: row.topic,
        reason: row.reason,
        durationMinutes: row.durationMinutes,
      })),
    });
  }
  if (reports?.reports?.length) {
    tables.push({
      id: 'reports',
      title: 'Power BI reports',
      source: 'powerbi',
      columns: [
        { key: 'name', label: 'Report', align: 'left' },
        { key: 'workspace', label: 'Workspace', align: 'left' },
        { key: 'measures', label: 'Measures', align: 'left' },
      ],
      rows: reports.reports.map((report) => ({
        name: report.name,
        workspace: report.workspace,
        measures: report.measures.join(', '),
        url: report.url,
      })),
    });
  }

  // ---- links back to the owning systems ------------------------------------
  const seen = new Set();
  for (const entry of facts) {
    const url = entry.citation?.url;
    if (url && !seen.has(url)) {
      seen.add(url);
      links.push({
        label: `Open ${SOURCE_LABELS[entry.citation.source] ?? entry.citation.source}`,
        url,
        system: entry.citation.source,
      });
    }
  }
  for (const report of reports?.reports ?? []) {
    if (!seen.has(report.url)) {
      seen.add(report.url);
      links.push({ label: report.name, url: report.url, system: 'powerbi' });
    }
  }
  if (maintenance?.total) {
    const app = EXTERNAL_APPS.find((entry) => entry.id === 'integral-portal');
    if (app && !seen.has(app.url)) {
      seen.add(app.url);
      links.push({ label: 'Integral Portal', url: app.url, system: 'integral_portal' });
    }
  }

  const metrics = kpiTiles(facts);

  return {
    headline,
    narrative,
    bullets,
    metrics,
    tables,
    charts,
    links,
    followUps: FOLLOW_UPS[intent] ?? defaultFollowUps,
    spoken: buildSpoken({ headline, narrative, bullets }),
  };
};

/**
 * The read-aloud form of the answer.
 *
 * Reading a full answer with its tables out loud is unusable, so voice gets the
 * headline, the first paragraph and at most one warning - the same facts, cut
 * to something a manager can take in while walking the line. Written-out
 * figures stay as they are; only the layout is different.
 */
export const buildSpoken = ({ headline, narrative = [], bullets = [] }) => {
  const tidy = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

  const head = tidy(headline);
  const parts = [head];

  if (narrative[0]) {
    let paragraph = tidy(narrative[0]);
    // The headline already named the period and shift; hearing "On Wednesday
    // 2026-10-07, Early shift (06:00-14:00)" again as the very next words is
    // the most obvious repetition out loud. The lookahead anchors on the
    // template's own continuations, so the strip stops before any figure -
    // matching on the date alone runs into the sentence and eats the numbers.
    paragraph = paragraph.replace(
      /^On .{0,80}?(?=\b(?:there were|there was|the production issue history holds)\b)/,
      '',
    );
    if (paragraph) parts.push(paragraph.replace(/^./, (character) => character.toUpperCase()));
  }

  // A warning worth hearing is one the narrative did not already state. The
  // bullets repeat figures from the paragraph by design on screen, where the
  // repetition reads as emphasis rather than as stammering.
  const sofar = parts.join(' ');
  const warning = bullets.find((bullet) => {
    if (bullet.tone !== 'warning') return false;
    const figure = tidy(bullet.text).match(/\d[\d,.]*/)?.[0];
    return !figure || !sofar.includes(figure);
  });
  if (warning) parts.push(tidy(warning.text));

  return speechSafe(
    parts
      .filter(Boolean)
      .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
      .join(' '),
  );
};

/**
 * Makes written shorthand speakable.
 *
 * "64 h 43 min" and "E-5007" are right on screen and wrong in the ear - a
 * speech synthesiser reads the abbreviations as letters and runs the code
 * together as a number. Only the spoken copy is rewritten; the displayed text
 * keeps the compact form.
 */
const speechSafe = (text) => {
  const unit = (value, singular) => `${value} ${Number(value) === 1 ? singular : `${singular}s`}`;

  return text
    .replace(/\b(\d+) h (\d+) min\b/g, (_, hours, minutes) => `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`)
    .replace(/\b(\d+) h\b/g, (_, hours) => unit(hours, 'hour'))
    .replace(/\b(\d+) min\b/g, (_, minutes) => unit(minutes, 'minute'))
    // Error codes read digit by digit: "E 5 0 0 7", not "E five thousand seven".
    .replace(/\bE-(\d{3,4})\b/g, (_, digits) => `E ${digits.split('').join(' ')}`)
    .replace(/\bCC-(\d{3,4})\b/g, (_, digits) => `cost center ${digits.split('').join(' ')}`)
    .replace(/\bCP-(\d{2,3})\b/g, (_, digits) => `checkpoint ${digits.split('').join(' ')}`)
    .replace(/\s+/g, ' ')
    .trim();
};
