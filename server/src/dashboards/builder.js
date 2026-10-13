import { newId } from '../utils/ids.js';
import { addDays, now, parseIsoDate, toIsoDate } from '../utils/dates.js';
import { parseQuestion, toFilter } from '../agent/nlu.js';
import { aggregateIssues, issueTrend, vehicleImpact } from '../agent/tools/production.js';
import { downtimeEvents } from '../agent/tools/systems.js';
import { SOURCE_LABELS } from '../connectors/index.js';
import { t } from '../agent/i18n.js';
import { saveDashboard } from './store.js';

/**
 * Builds a dashboard from a question.
 *
 * The question is interpreted by the same NLU the chat uses, so "paint line
 * issues this week" resolves to the same line and period a chat answer would.
 * Widgets are then chosen from what the question emphasises and filled by the
 * existing production tools - nothing here reads data on its own.
 *
 * Widget: { id, type: 'kpi'|'bar'|'line'|'pie', title, source: { label,
 *           object }, query, data }
 *   kpi data     { value, unit, delta? }
 *   bar/pie data [{ name, value }]
 *   line data    [{ date, value }]
 */

const TITLES = {
  en: {
    issuesByLine: 'Issues by production line',
    issuesByCode: 'Issues by error code',
    issuesByShift: 'Issues by shift',
    issuesByModel: 'Issues by vehicle model',
    issuesByPart: 'Issues by part',
    trend: 'Issues per day',
    vehicles: 'Vehicles affected',
    reworked: 'Vehicles reworked',
    removed: 'Removed from line',
    reworkMinutes: 'Rework time',
    downtime: 'Recorded downtime',
    lastDays: 'the last {days} days',
  },
  de: {
    issuesByLine: 'Probleme je Produktionslinie',
    issuesByCode: 'Probleme je Fehlercode',
    issuesByShift: 'Probleme je Schicht',
    issuesByModel: 'Probleme je Fahrzeugmodell',
    issuesByPart: 'Probleme je Teil',
    trend: 'Probleme pro Tag',
    vehicles: 'Betroffene Fahrzeuge',
    reworked: 'Nachgearbeitete Fahrzeuge',
    removed: 'Aus der Linie genommen',
    reworkMinutes: 'Nacharbeitszeit',
    downtime: 'Erfasster Stillstand',
    lastDays: 'die letzten {days} Tage',
  },
};

const ISSUES_SOURCE = { label: SOURCE_LABELS.databricks, object: 'prod_quality.issue_events' };
const REWORK_SOURCE = { label: SOURCE_LABELS.databricks, object: 'prod_quality.rework_records' };
const MQTT_SOURCE = { label: SOURCE_LABELS.mqtt, object: 'plant1/+/+/state' };

const daysBetween = (from, to) =>
  Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86400000) + 1;

/** The same window immediately before the period, for KPI deltas. */
const previousPeriod = (filter) => {
  const days = daysBetween(filter.from, filter.to);
  return {
    ...filter,
    from: toIsoDate(addDays(parseIsoDate(filter.from), -days)),
    to: toIsoDate(addDays(parseIsoDate(filter.from), -1)),
  };
};

/** Runs one widget query against the production tools and returns its data. */
export const runWidgetQuery = async (query, filter) => {
  switch (query.kind) {
    case 'aggregate': {
      const { data } = await aggregateIssues.run({ filter, dimension: query.dimension, limit: query.limit ?? 8 });
      return data.buckets.map((bucket) => ({ name: bucket.label, value: bucket.count }));
    }
    case 'trend': {
      const { data } = await issueTrend.run({ filter });
      return data.series.map((point) => ({ date: point.date, value: point.count }));
    }
    case 'impact': {
      const [{ data: current }, { data: previous }] = await Promise.all([
        vehicleImpact.run({ filter }),
        vehicleImpact.run({ filter: previousPeriod(filter) }),
      ]);
      const value = current[query.metric] ?? 0;
      return { value, unit: query.metric === 'reworkMinutes' ? 'min' : '', delta: value - (previous[query.metric] ?? 0) };
    }
    case 'downtime': {
      const [{ data: current }, { data: previous }] = await Promise.all([
        downtimeEvents.run({ filter, limit: 500 }),
        downtimeEvents.run({ filter: previousPeriod(filter), limit: 500 }),
      ]);
      return { value: current.totalMinutes, unit: 'min', delta: current.totalMinutes - previous.totalMinutes };
    }
    default:
      return null;
  }
};

const widget = (type, title, source, query) => ({ id: newId('wdg'), type, title, source, query, data: null });

/** Picks the widgets the question calls for, most relevant first, at most six. */
const chooseWidgets = (interpretation, language) => {
  const text = String(interpretation.question ?? '').toLowerCase();
  const titles = TITLES[language];
  const { entities } = interpretation;
  const chosen = [];

  const wantsCodes = /error code|fehlercode|codes?\b/.test(text);
  const wantsShift = /shift|schicht/.test(text);
  const wantsModel = /model/.test(text);
  const wantsPart = /\bparts?\b|\bteile?\b|component|komponent/.test(text);
  const wantsDowntime = /downtime|stillstand|ausfall|stop/.test(text);
  const wantsRework = /rework|nacharbeit/.test(text);
  const wantsTrend = /trend|verlauf|per day|pro tag|over time/.test(text);

  const byLine = () => widget('bar', titles.issuesByLine, ISSUES_SOURCE, { kind: 'aggregate', dimension: 'lineId' });
  const byCode = (type) => widget(type, titles.issuesByCode, ISSUES_SOURCE, { kind: 'aggregate', dimension: 'errorCode' });
  const byShift = () => widget('bar', titles.issuesByShift, ISSUES_SOURCE, { kind: 'aggregate', dimension: 'shiftId' });
  const byModel = () => widget('bar', titles.issuesByModel, ISSUES_SOURCE, { kind: 'aggregate', dimension: 'modelId' });
  const byPart = () => widget('bar', titles.issuesByPart, ISSUES_SOURCE, { kind: 'aggregate', dimension: 'partId' });
  const trend = () => widget('line', titles.trend, ISSUES_SOURCE, { kind: 'trend' });
  const vehicles = () => widget('kpi', titles.vehicles, ISSUES_SOURCE, { kind: 'impact', metric: 'affected' });
  const reworked = () => widget('kpi', titles.reworked, REWORK_SOURCE, { kind: 'impact', metric: 'reworked' });
  const removed = () => widget('kpi', titles.removed, REWORK_SOURCE, { kind: 'impact', metric: 'removed' });
  const reworkMinutes = () => widget('kpi', titles.reworkMinutes, REWORK_SOURCE, { kind: 'impact', metric: 'reworkMinutes' });
  const downtime = () => widget('kpi', titles.downtime, MQTT_SOURCE, { kind: 'downtime' });

  // KPIs first: the emphasised one leads.
  if (wantsDowntime) chosen.push(downtime());
  if (wantsRework) chosen.push(reworked(), reworkMinutes());
  chosen.push(vehicles());
  if (!wantsRework) chosen.push(reworked());
  if (!wantsDowntime) chosen.push(downtime());
  if (wantsRework) chosen.push(removed());

  // Breakdowns: a pie for the emphasised dimension, bars for the rest.
  if (wantsCodes) chosen.push(byCode('pie'));
  if (wantsShift || entities.shiftId) chosen.push(byShift());
  if (wantsModel) chosen.push(byModel());
  if (wantsPart) chosen.push(byPart());
  // A single named line has one bucket, so break it down by code instead.
  if (!entities.lineId) chosen.push(byLine());
  else if (!wantsCodes) chosen.push(byCode('bar'));
  if (!wantsCodes && !entities.lineId) chosen.push(byCode('bar'));

  // A multi-day period always gets the trend; a single day only on request.
  const multiDay = interpretation.resolvedTimeframe.from !== interpretation.resolvedTimeframe.to;
  if (multiDay || wantsTrend) chosen.push(trend());

  return chosen.slice(0, 6);
};

/**
 * @param {{ question: string, title?: string, language?: 'en'|'de', createdBy: string }} args
 */
export const buildDashboard = async ({ question, title, language, createdBy }) => {
  const interpretation = parseQuestion(question, language ? { language } : {});
  const lang = interpretation.language;

  // A dashboard for "paint line issues" without a period covers the last
  // week; a single assumed day makes a poor dashboard.
  let period = interpretation.resolvedTimeframe;
  if (period.assumed) {
    const from = toIsoDate(addDays(now(), -6));
    const to = toIsoDate(now());
    period = { from, to, label: t(lang, 'period.lastDays', { days: 7 }), expression: null, assumed: true };
    interpretation.resolvedTimeframe = period;
  }

  const filter = toFilter(interpretation);
  const widgets = chooseWidgets(interpretation, lang);

  const dashboard = {
    id: newId('dash'),
    title: String(title ?? '').trim() || interpretation.entities.dashboardTitle || question,
    question,
    language: lang,
    createdAt: new Date().toISOString(),
    createdBy,
    period: { from: period.from, to: period.to, label: period.label },
    filter: Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined)),
    widgets,
  };

  await refreshDashboard(dashboard);
  // Drop breakdown charts (bar/line/pie) that have no rows for this period, so
  // the dashboard never shows a blank tile. KPI tiles always carry a number
  // (0 included) and are kept. If every chart is empty the KPIs still stand.
  dashboard.widgets = dashboard.widgets.filter((w) => w.type === 'kpi' || hasChartData(w.data));
  saveDashboard(dashboard);
  return dashboard;
};

/** True when a chart widget has at least one data point. */
const hasChartData = (data) => Array.isArray(data) && data.length > 0;

/** Recomputes every widget's data from the repository; returns the dashboard. */
export const refreshDashboard = async (dashboard) => {
  const filter = { ...dashboard.filter, from: dashboard.period.from, to: dashboard.period.to };
  for (const entry of dashboard.widgets) {
    entry.data = await runWidgetQuery(entry.query, filter);
  }
  dashboard.refreshedAt = new Date().toISOString();
  return dashboard;
};
