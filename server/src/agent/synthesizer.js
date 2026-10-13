import { INTENTS, describeDate, describeShift } from './nlu.js';
import { SOURCE_LABELS } from '../connectors/index.js';
import { EXTERNAL_APPS } from '../data/catalog.js';
import { formatRange } from '../utils/dates.js';
import { GREETING_PROMPT, GREETING_PROMPT_DE, currentHour, greetingFor } from './greeting.js';
import { labelFor } from './labels.js';
import { DIMENSION_LABELS } from '../data/repository.js';
import { dateLabel, dateTimeLabel, minutesLabel, normalizeLanguage, t, tCount, timeLabel } from './i18n.js';

/**
 * Answer composition.
 *
 * Takes the facts the tools returned and builds one consolidated answer:
 * headline, narrative, KPI tiles, tables, chart series, source citations and
 * follow-up questions. Numbers are only ever copied from retrieved facts -
 * nothing here invents a figure, which is what keeps the optional LLM pass in
 * llm.js safe to switch on.
 *
 * Wording comes from i18n.js so English and German stay side by side; the
 * data shapes are identical in both languages.
 */

const plural = (count, singular, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export const formatMinutes = (minutes, language = 'en') => minutesLabel(minutes, language);

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

const mailTable = (id, title, items, language) => ({
  id,
  title,
  source: 'microsoft365',
  columns: [
    { key: 'receivedAt', label: language === 'de' ? 'Eingang' : 'Received', align: 'left', format: 'time' },
    { key: 'from', label: language === 'de' ? 'Von' : 'From', align: 'left' },
    { key: 'subject', label: language === 'de' ? 'Betreff' : 'Subject', align: 'left' },
    { key: 'category', label: language === 'de' ? 'Kategorie' : 'Category', align: 'left' },
    { key: 'status', label: 'Status', align: 'left', format: 'status' },
  ],
  rows: items.map((mail) => ({
    id: mail.id,
    receivedAt: mail.receivedAt,
    from: mail.from.name,
    subject: mail.subject,
    category: mail.category,
    status: mail.replied ? 'replied' : mail.needsReply ? 'needs_reply' : mail.read ? 'read' : 'unread',
    flagged: mail.flagged,
  })),
});

const periodPhrase = (interpretation, language) => {
  const { resolvedTimeframe, entities } = interpretation;
  const base =
    resolvedTimeframe.from === resolvedTimeframe.to
      ? describeDate(resolvedTimeframe.from, language)
      : formatRange(resolvedTimeframe);
  return entities.shiftId ? `${base}, ${describeShift(entities.shiftId, language)}` : base;
};

const scopePhrase = (interpretation, language) => {
  const { entities } = interpretation;
  const parts = [];
  if (entities.line) parts.push(entities.line.name);
  if (entities.model) parts.push(entities.model.name);
  if (entities.errorCodeEntry) parts.push(`${entities.errorCodeEntry.code} ${entities.errorCodeEntry.description}`);
  if (entities.part) parts.push(entities.part.name);
  if (entities.checkpoint) parts.push(entities.checkpoint.name);
  if (entities.severity) parts.push(t(language, 'severity.suffix', { severity: entities.severity }));
  return parts.length > 0 ? t(language, 'period.for', { scope: parts.join(', ') }) : '';
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

  const measure = fact(facts, 'powerbi.measure')?.measure;
  if (measure) {
    tiles.push(
      metric(measure.key, measure.name, measure.rawValue, measure.format, 'powerbi', {
        restricted: measure.restricted,
      }),
    );
  }

  const mail = fact(facts, 'mail.search');
  if (mail && mail.unread !== undefined) {
    tiles.push(metric('mail_unread', 'Unread mail', mail.unread, 'integer', 'microsoft365'));
    tiles.push(
      metric('mail_needs_reply', 'Awaiting reply', mail.needsReply, 'integer', 'microsoft365', {
        tone: mail.needsReply > 0 ? 'warning' : 'good',
      }),
    );
  }

  return tiles;
};

/** Follow-up question sets, by i18n key prefix. */
const FOLLOW_UP_KEYS = {
  [INTENTS.ISSUE_SUMMARY]: 'issues',
  [INTENTS.DAILY_SUMMARY]: 'daily',
  [INTENTS.SHIFT_SUMMARY]: 'shift',
  [INTENTS.TOP_ERROR_CODES]: 'codes',
  [INTENTS.LINE_ISSUES]: 'lines',
  [INTENTS.INBOX_SUMMARY]: 'inbox',
  [INTENTS.MAIL_SEARCH]: 'inbox',
  [INTENTS.CALENDAR_TODAY]: 'calendar',
  [INTENTS.DAILY_BRIEFING]: 'briefing',
  [INTENTS.CREATE_REMINDER]: 'reminder',
  [INTENTS.DRAFT_REPLY]: 'draft',
  [INTENTS.POWERBI_MEASURE]: 'measure',
  [INTENTS.CREATE_DASHBOARD]: 'dashboard',
};

/** English-only follow-ups for the intents that keep their original wording. */
const FOLLOW_UPS_EN = {
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

const followUpsFor = (intent, language) => {
  const key = FOLLOW_UP_KEYS[intent];
  if (key) return [1, 2, 3].map((index) => t(language, `followUps.${key}.${index}`));
  if (language === 'en' && FOLLOW_UPS_EN[intent]) return FOLLOW_UPS_EN[intent];
  return [1, 2, 3].map((index) => t(language, `followUps.default.${index}`));
};

/**
 * @param {object} args
 * @param {object} args.interpretation
 * @param {Array<{tool: string, data: object, citation: object}>} args.facts
 * @param {object} args.access role + permissions
 * @param {'en'|'de'} [args.language]
 * @param {Array<{tool: string, permission: string}>} [args.withheld] tools skipped for the role
 */
export const compose = ({ interpretation, facts, access, language, withheld = [] }) => {
  const lang = normalizeLanguage(language ?? interpretation.language);
  const period = periodPhrase(interpretation, lang);
  const singleDay = interpretation.resolvedTimeframe.from === interpretation.resolvedTimeframe.to;
  // "on Friday" / "am Freitag" for a day, "for this week" / "für diese Woche" for a range.
  const on = t(lang, singleDay ? 'period.on' : 'period.onRange', { period });
  const On = on.replace(/^./, (character) => character.toUpperCase());
  const scope = scopePhrase(interpretation, lang);
  const intent = interpretation.intent;

  const narrative = [];
  const bullets = [];
  const tables = [];
  const charts = [];
  const links = [];
  let spokenOverride = null;

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

  // Secretary facts.
  const mail = fact(facts, 'mail.search');
  const needsReply = fact(facts, 'mail.needsReply');
  const draft = fact(facts, 'mail.draft');
  const events = fact(facts, 'calendar.events');
  const tasksDue = fact(facts, 'tasks.due');
  const created = fact(facts, 'tasks.create');
  const briefing = fact(facts, 'briefing.compose');
  const measure = fact(facts, 'powerbi.measure');
  const dashboard = fact(facts, 'dashboard.create')?.dashboard ?? null;

  const total = issueTotal ?? issues?.total ?? errorCodes?.buckets?.reduce((sum, b) => sum + b.count, 0) ?? 0;
  const minutes = (value) => minutesLabel(value, lang);
  const count = (key, value) => tCount(lang, key, value);

  // The whole plan was withheld: say so instead of narrating an empty answer.
  const everythingWithheld = facts.length === 0 && withheld.length > 0;

  let headline;

  if (everythingWithheld) {
    headline = t(lang, 'withheld.headline');
    narrative.push(
      t(lang, 'withheld.narrative', {
        role: access.roleName ?? access.role,
        permissions: [...new Set(withheld.map((entry) => entry.permission))].join(', '),
      }),
    );
  } else {
    switch (intent) {
      case INTENTS.GREETING:
        // Same opening the voice loop speaks on wake, so "hey Jervis" and a
        // typed "hello" are answered with one voice.
        headline = greetingFor(currentHour(), undefined, lang);
        narrative.push(t(lang, 'greeting.intro', { prompt: lang === 'de' ? GREETING_PROMPT_DE : GREETING_PROMPT }));
        break;

      case INTENTS.CAPABILITIES:
        headline = t(lang, 'capabilities.headline');
        narrative.push(t(lang, 'capabilities.intro'));
        bullets.push(
          { text: t(lang, 'capabilities.item.problems') },
          { text: t(lang, 'capabilities.item.causes') },
          { text: t(lang, 'capabilities.item.rework') },
          { text: t(lang, 'capabilities.item.shifts') },
          { text: t(lang, 'capabilities.item.maintenance') },
          { text: t(lang, 'capabilities.item.links') },
          { text: t(lang, 'capabilities.item.mail') },
          { text: t(lang, 'capabilities.item.calendar') },
          { text: t(lang, 'capabilities.item.dashboards') },
        );
        break;

      case INTENTS.UNKNOWN:
        headline = t(lang, 'unknown.headline');
        narrative.push(t(lang, 'unknown.narrative'));
        break;

      case INTENTS.DAILY_SUMMARY:
      case INTENTS.SHIFT_SUMMARY: {
        headline =
          total === 0
            ? t(lang, 'summary.none.headline', { on, scope })
            : t(lang, 'summary.headline', { issues: count('count.issue', total), on, scope });
        if (total === 0) {
          narrative.push(t(lang, 'summary.none', { period, scope }));
          break;
        }
        narrative.push(
          t(lang, 'summary.narrative', {
            period,
            On,
            scope,
            issues: count('count.issueEvent', total),
            vehicles: count('count.vehicle', impact?.affected ?? 0),
            removed: impact?.removed ?? 0,
            rework: minutes(impact?.reworkMinutes ?? 0),
          }),
        );
        if (errorCodes?.buckets?.length) {
          narrative.push(t(lang, 'summary.dominant', { codes: topBucketText(errorCodes.buckets, 'errorCode') }));
        }
        if (shifts?.buckets?.length && intent === INTENTS.DAILY_SUMMARY) {
          const worst = shifts.buckets[0];
          bullets.push({
            text: t(lang, 'summary.heaviestShift', {
              shift: lang === 'de' ? describeShift(worst.key, 'de') : worst.label,
              issues: count('count.issueDative', worst.count),
            }),
            tone: 'warning',
          });
        }
        if (lines?.buckets?.length) {
          bullets.push({
            text: t(lang, 'summary.mostAffectedLine', { line: lines.buckets[0].label, count: lines.buckets[0].count }),
          });
        }
        if (downtime?.totalMinutes) {
          bullets.push({
            text: t(lang, 'summary.downtime', {
              minutes: minutes(downtime.totalMinutes),
              stops: count('count.stop', downtime.rows.length),
            }),
          });
        }
        if (maintenance?.total) {
          bullets.push({
            text: t(lang, 'summary.maintenance', {
              tickets: count('count.ticket', maintenance.total),
              open: maintenance.open,
            }),
            tone: maintenance.open > 0 ? 'warning' : 'good',
          });
        }
        break;
      }

      case INTENTS.TOP_ERROR_CODES: {
        const codeCount = errorCodes?.buckets?.length ?? 0;
        headline = t(lang, 'codes.headline', { count: codeCount, on, scope });
        if (codeCount === 0) {
          narrative.push(t(lang, 'codes.none', { period, scope }));
          break;
        }
        narrative.push(
          t(lang, 'codes.narrative', {
            count: codeCount,
            issues: count('count.issue', total),
            on,
            scope,
            codes: topBucketText(errorCodes.buckets, 'errorCode'),
          }),
        );
        break;
      }

      case INTENTS.AFFECTED_MODELS: {
        const modelCount = models?.buckets?.length ?? 0;
        headline = `${modelCount} vehicle ${modelCount === 1 ? 'model' : 'models'} affected ${on}${scope}`;
        if (modelCount === 0) {
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
        const lineCount = lines?.buckets?.length ?? 0;
        headline =
          lineCount > 0
            ? t(lang, 'lines.headline', { line: lines.buckets[0].label, on })
            : t(lang, 'lines.none.headline', { on });
        if (lineCount === 0) {
          narrative.push(t(lang, 'lines.none', { period, scope }));
          break;
        }
        narrative.push(
          t(lang, 'lines.narrative', {
            period,
            On,
            scope,
            lines: topBucketText(lines.buckets, 'lineId', 4),
            line: lines.buckets[0].label,
            issues: count('count.issueDative', lines.buckets[0].count),
            rework: minutes(lines.buckets[0].reworkMinutes),
          }),
        );
        if (downtime?.byLine?.length) {
          bullets.push({
            text: t(lang, 'lines.longestDowntime', {
              line: downtime.byLine[0].label,
              minutes: minutes(downtime.byLine[0].minutes),
            }),
          });
        }
        break;
      }

      case INTENTS.PARTS_INVOLVED: {
        const partCount = parts?.buckets?.length ?? 0;
        headline = `${partCount} ${partCount === 1 ? 'part' : 'parts'} involved ${on}${scope}`;
        if (partCount === 0) {
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
        headline = `${impact?.affected ?? 0} vehicles affected ${on}${scope}`;
        narrative.push(
          `${plural(impact?.affected ?? 0, 'vehicle')} were affected ${on}${scope}. ${impact?.reworked ?? 0} needed rework and ${impact?.removed ?? 0} were removed from the line.`,
        );
        if (models?.buckets?.length) {
          narrative.push(`By model: ${topBucketText(models.buckets, 'modelId', 5)}.`);
        }
        break;
      }

      case INTENTS.REWORK_COUNT: {
        headline = `${impact?.reworked ?? 0} vehicles reworked ${on}${scope}`;
        narrative.push(
          `${plural(impact?.reworked ?? 0, 'vehicle')} went through rework ${on}${scope}, of which ${impact?.removed ?? 0} were removed from the line. Booked rework time was ${formatMinutes(impact?.reworkMinutes ?? 0)}.`,
        );
        if (rework?.buckets?.length) {
          narrative.push(`By category: ${topBucketText(rework.buckets, 'reworkCategoryId', 5)}.`);
        }
        break;
      }

      case INTENTS.CHECKPOINT_DETECTION: {
        const checkpointCount = checkpoints?.buckets?.length ?? 0;
        headline = `${checkpointCount} ${checkpointCount === 1 ? 'checkpoint' : 'checkpoints'} detected issues ${on}${scope}`;
        if (checkpointCount === 0) {
          narrative.push(`No checkpoint detections were recorded for ${period}${scope}.`);
          break;
        }
        narrative.push(`Detections came from ${topBucketText(checkpoints.buckets, 'checkpointId', 5)}.`);
        break;
      }

      case INTENTS.COST_CENTER_IMPACT: {
        const centerCount = costCenters?.buckets?.length ?? 0;
        headline = `Cost center impact for ${period}${scope}`;
        if (!access.permissions.includes('finance:read')) {
          narrative.push(
            'Cost figures sit in the restricted Finance workspace report. Your role can see the issue distribution across cost centers, but not the monetary values.',
          );
        }
        if (centerCount > 0) {
          narrative.push(`Issues distributed across ${topBucketText(costCenters.buckets, 'costCenter', 5)}.`);
        }
        narrative.push(`Rework effort behind those issues totals ${formatMinutes(impact?.reworkMinutes ?? 0)}.`);
        break;
      }

      case INTENTS.MAINTENANCE_STATUS: {
        headline = `${maintenance?.total ?? 0} maintenance tickets ${on}${scope}`;
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
        headline = `${formatMinutes(downtime?.totalMinutes ?? 0)} of downtime ${on}${scope}`;
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

      // ---- secretary ----------------------------------------------------------
      case INTENTS.INBOX_SUMMARY: {
        const unread = mail?.unread ?? 0;
        const awaiting = mail?.needsReply ?? needsReply?.total ?? 0;
        headline = t(lang, 'inbox.headline', { unread, needsReply: awaiting });
        narrative.push(t(lang, 'inbox.narrative', { total: mail?.inboxTotal ?? mail?.total ?? 0, unread, needsReply: awaiting }));
        if (mail && mail.filter !== 'all') {
          narrative.push(
            t(lang, 'inbox.filtered', { count: mail.total, filter: t(lang, `inbox.filter.${mail.filter}`) }),
          );
        }
        const top = needsReply?.items ?? [];
        if (top.length) {
          narrative.push(
            t(lang, 'inbox.top', {
              items: top.map((item) => `"${item.subject}" (${item.from.name})`).join('; '),
            }),
          );
          for (const item of top) {
            bullets.push({ text: `${item.from.name}: ${item.subject}`, tone: item.flagged ? 'warning' : 'neutral' });
          }
        }
        if (mail?.items?.length) tables.push(mailTable('inbox', lang === 'de' ? 'Posteingang' : 'Inbox', mail.items, lang));
        break;
      }

      case INTENTS.MAIL_SEARCH: {
        const found = mail?.total ?? 0;
        if (found === 0) {
          headline = t(lang, 'mail.search.none.headline');
          narrative.push(t(lang, 'mail.search.none', { query: mail?.query ?? interpretation.entities.mailQuery ?? '' }));
          break;
        }
        const best = mail.items[0];
        headline = t(lang, 'mail.search.headline', { count: found });
        narrative.push(
          t(lang, 'mail.search.narrative', {
            subject: best.subject,
            from: best.from.name,
            received: dateTimeLabel(best.receivedAt, lang),
          }),
        );
        tables.push(mailTable('mail-search', lang === 'de' ? 'Treffer' : 'Matches', mail.items, lang));
        break;
      }

      case INTENTS.CALENDAR_TODAY: {
        const items = events?.items ?? [];
        const requested = events?.requested ?? 'today';
        const dayWord =
          requested === 'tomorrow'
            ? t(lang, 'calendar.tomorrow')
            : requested === 'today'
              ? t(lang, 'calendar.today')
              : t(lang, 'calendar.on', { date: dateLabel(events?.day ?? requested, lang) });
        if (items.length === 0) {
          headline = t(lang, 'calendar.none.headline', { day: dayWord });
          narrative.push(t(lang, 'calendar.none', { day: dayWord }));
        } else {
          headline = t(lang, 'calendar.headline', { count: items.length, day: dayWord });
          narrative.push(
            t(lang, 'calendar.narrative', {
              day: dayWord,
              items: items.map((event) => `${timeLabel(event.startsAt)} ${event.title}${event.location ? ` (${event.location})` : ''}`).join(', '),
            }),
          );
          tables.push({
            id: 'calendar',
            title: lang === 'de' ? 'Termine' : 'Appointments',
            source: 'microsoft365',
            columns: [
              { key: 'time', label: lang === 'de' ? 'Zeit' : 'Time', align: 'left' },
              { key: 'title', label: lang === 'de' ? 'Termin' : 'Appointment', align: 'left' },
              { key: 'location', label: lang === 'de' ? 'Ort' : 'Location', align: 'left' },
              { key: 'organizer', label: lang === 'de' ? 'Organisator' : 'Organizer', align: 'left' },
            ],
            rows: items.map((event) => ({
              id: event.id,
              time: `${timeLabel(event.startsAt)}-${timeLabel(event.endsAt)}`,
              title: event.title,
              location: event.location,
              organizer: event.organizer,
              isOnline: event.isOnline,
            })),
          });
        }
        const dueCount = (tasksDue?.dueToday ?? 0) + (tasksDue?.overdue ?? 0);
        if (dueCount > 0) {
          bullets.push({ text: t(lang, 'calendar.tasksDue', { count: dueCount }), tone: tasksDue.overdue > 0 ? 'warning' : 'neutral' });
        }
        break;
      }

      case INTENTS.DAILY_BRIEFING: {
        headline = briefing?.headline ?? t(lang, 'briefing.headline', { date: dateLabel(interpretation.resolvedTimeframe.from, lang) });
        narrative.push(t(lang, 'briefing.greeting', { greeting: briefing?.greeting ?? greetingFor(currentHour(), undefined, lang) }));
        for (const section of briefing?.sections ?? []) {
          narrative.push(`${section.title}: ${section.headline}.`);
          for (const item of section.items) {
            if (item.severity === 'critical' || item.severity === 'warning') {
              bullets.push({ text: `${item.label} - ${item.detail}`, tone: 'warning' });
            }
          }
        }
        if (briefing?.spoken) spokenOverride = briefing.spoken;
        break;
      }

      case INTENTS.CREATE_REMINDER: {
        const task = created?.task ?? null;
        if (!task) {
          headline = t(lang, 'reminder.failed.headline');
          narrative.push(t(lang, 'reminder.failed'));
          break;
        }
        headline = t(lang, 'reminder.headline', { title: task.title });
        narrative.push(
          task.dueAt
            ? t(lang, 'reminder.narrative.due', { title: task.title, due: dateTimeLabel(task.dueAt, lang) })
            : t(lang, 'reminder.narrative.noDue', { title: task.title }),
        );
        break;
      }

      case INTENTS.DRAFT_REPLY: {
        if (!draft?.draft) {
          headline = t(lang, 'draft.none.headline');
          narrative.push(t(lang, 'draft.none'));
          break;
        }
        headline = t(lang, 'draft.headline', { subject: draft.mail.subject });
        narrative.push(
          t(lang, 'draft.narrative', {
            tone: lang === 'de' ? (draft.draft.tone === 'formal' ? 'förmliche' : 'freundliche') : draft.draft.tone,
            from: draft.mail.from.name,
          }),
        );
        narrative.push(draft.draft.body);
        break;
      }

      case INTENTS.POWERBI_MEASURE: {
        const found = measure?.measure ?? null;
        if (!found) {
          headline = t(lang, 'measure.none.headline', { query: measure?.query ?? '' });
          narrative.push(t(lang, 'measure.none', { available: (measure?.available ?? []).join(', ') }));
          break;
        }
        const shown = found.value === null ? 'n/a' : `${found.value}${found.unit === '%' ? ' %' : found.unit ? ` ${found.unit}` : ''}`;
        headline = t(lang, 'measure.headline', { name: found.name, value: shown });
        narrative.push(t(lang, 'measure.narrative', { name: found.name, value: shown, period, scope, report: found.report }));
        links.push({ label: found.report, url: found.url, system: 'powerbi' });
        break;
      }

      case INTENTS.CREATE_DASHBOARD: {
        if (!dashboard) {
          headline = t(lang, 'dashboard.failed.headline');
          narrative.push(t(lang, 'dashboard.failed'));
          break;
        }
        headline = t(lang, 'dashboard.headline', { title: dashboard.title });
        narrative.push(
          t(lang, 'dashboard.narrative', {
            count: dashboard.widgets.length,
            period: dashboard.period.label,
            scope,
            widgets: dashboard.widgets.map((entry) => entry.title).join(', '),
          }),
        );
        links.push({ label: dashboard.title, url: `dashboards/${dashboard.id}`, system: 'dashboards' });
        break;
      }

      case INTENTS.ISSUE_SUMMARY:
      default: {
        headline =
          total === 0
            ? t(lang, 'issues.none.headline', { on, scope })
            : t(lang, 'issues.headline', { problems: count('count.problem', total), on, scope });
        if (total === 0) {
          narrative.push(t(lang, 'issues.none', { period, scope }));
          break;
        }
        narrative.push(
          t(lang, 'issues.narrative', {
            period,
            On,
            scope,
            issues: count('count.issueEvent', total),
            vehicles: count('count.vehicle', impact?.affected ?? 0),
            removed: impact?.removed ?? 0,
            rework: minutes(impact?.reworkMinutes ?? 0),
          }),
        );
        if (errorCodes?.buckets?.length) {
          const top = errorCodes.buckets[0];
          narrative.push(
            t(lang, 'issues.biggest', {
              code: top.label,
              occurrences: count('count.occurrence', top.count),
              codes: topBucketText(errorCodes.buckets, 'errorCode', 4),
            }),
          );
        }
        if (lines?.buckets?.length) {
          bullets.push({
            text: t(lang, 'summary.mostAffectedLine', { line: lines.buckets[0].label, count: lines.buckets[0].count }),
          });
        }
        if (impact?.removed) {
          bullets.push({ text: t(lang, 'issues.removed', { vehicles: count('count.vehicle', impact.removed) }), tone: 'warning' });
        }
        break;
      }
    }
  }

  // Partially withheld plans get a bullet so the answer says what is missing.
  for (const entry of withheld) {
    if (everythingWithheld) break;
    bullets.push({ text: t(lang, 'withheld.tool', { tool: entry.label, permission: entry.permission }), tone: 'warning' });
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
  const seen = new Set(links.map((link) => link.url));
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
    followUps: followUpsFor(intent, lang),
    spoken: spokenOverride ?? buildSpoken({ headline, narrative, bullets }, lang),
    spokenOverride,
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
export const buildSpoken = ({ headline, narrative = [], bullets = [] }, language = 'en') => {
  const lang = normalizeLanguage(language);
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
    paragraph = paragraph
      .replace(/^On .{0,80}?(?=\b(?:there were|there was|the production issue history holds)\b)/, '')
      .replace(/^(?:Am|Für) .{0,80}?(?=\b(?:gab es|enthält die Problemhistorie)\b)/, '');
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
    lang,
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
const speechSafe = (text, language = 'en') => {
  const unit = (value, singular) => `${value} ${Number(value) === 1 ? singular : `${singular}s`}`;
  const unitDe = (value, singular, pluralForm) => `${value} ${Number(value) === 1 ? singular : pluralForm}`;

  if (language === 'de') {
    return text
      .replace(/\b(\d+) Std\. (\d+) Min\./g, (_, hours, minutes) => `${unitDe(hours, 'Stunde', 'Stunden')} ${unitDe(minutes, 'Minute', 'Minuten')}`)
      .replace(/\b(\d+) Std\./g, (_, hours) => unitDe(hours, 'Stunde', 'Stunden'))
      .replace(/\b(\d+) Min\./g, (_, minutes) => unitDe(minutes, 'Minute', 'Minuten'))
      .replace(/\bE-(\d{3,4})\b/g, (_, digits) => `E ${digits.split('').join(' ')}`)
      .replace(/\bCC-(\d{3,4})\b/g, (_, digits) => `Kostenstelle ${digits.split('').join(' ')}`)
      .replace(/\bCP-(\d{2,3})\b/g, (_, digits) => `Prüfpunkt ${digits.split('').join(' ')}`)
      .replace(/\s+/g, ' ')
      .trim();
  }

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
