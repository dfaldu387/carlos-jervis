import { Router } from 'express';
import { config, llmEnabled } from '../config.js';
import { getRepository } from '../data/index.js';
import { buildConnectorRegistry } from '../connectors/index.js';
import { fetchMeasures } from '../connectors/powerbi.connector.js';
import { toolCatalog } from '../agent/tools/index.js';
import { labelFor } from '../agent/labels.js';
import { SHIFTS, addDays, now, toIsoDate } from '../utils/dates.js';

export const commandCenterRouter = Router();

/**
 * Everything the command centre renders, in one call.
 *
 * The dashboard is a single view of live production state, so it reads as one
 * snapshot rather than eight panels disagreeing with each other by a few
 * seconds. Each panel's data is derived from the same systems the assistant
 * queries - nothing here is decorative.
 */

const PERIOD_DAYS = 14;

/** Minutes of production available per line per shift, for downtime share. */
const SHIFT_MINUTES = 8 * 60;

const severityTone = (severity) =>
  ({ critical: 'critical', high: 'serious', medium: 'warning', low: 'good' })[severity] ?? 'info';

commandCenterRouter.get('/', async (req, res, next) => {
  try {
    const repository = getRepository();
    const meta = await repository.meta();

    const today = meta.referenceDate ?? toIsoDate(now());
    const periodFrom = toIsoDate(addDays(now(), -(PERIOD_DAYS - 1)));
    const dayFilter = { from: today, to: today };
    const periodFilter = { from: periodFrom, to: today };

    const [
      dayIssues,
      dayImpact,
      dayByShift,
      dayByLine,
      dayByErrorCode,
      dayMaintenance,
      dayDowntime,
      trend,
      measures,
    ] = await Promise.all([
      repository.listIssues({ ...dayFilter, limit: 40 }),
      repository.vehicleImpact(dayFilter),
      repository.aggregateIssues(dayFilter, 'shiftId'),
      repository.aggregateIssues(dayFilter, 'lineId'),
      repository.aggregateIssues({ ...dayFilter, limit: 5 }, 'errorCode'),
      repository.listMaintenance({ ...dayFilter, limit: 20 }),
      repository.listDowntime({ ...dayFilter, limit: 20 }),
      repository.dailyTrend(periodFilter),
      fetchMeasures(dayFilter, {
        includeRestricted: req.access.permissions.includes('finance:read'),
      }),
    ]);

    const connectors = buildConnectorRegistry();
    const openTickets = dayMaintenance.filter((ticket) => ticket.status === 'open');
    const downtimeMinutes = dayDowntime.reduce((sum, event) => sum + event.durationMinutes, 0);
    const criticalIssues = dayIssues.filter((issue) => issue.severity === 'critical');
    const measureValue = (key) => measures.measures.find((entry) => entry.key === key)?.value ?? null;

    // ---- core subsystem status -------------------------------------------
    const core = [
      {
        id: 'understanding',
        label: 'Understanding',
        state: 'online',
        detail: 'Natural language parsing',
      },
      {
        id: 'planner',
        label: 'Planner',
        state: 'online',
        detail: `${toolCatalog().length} retrieval tools`,
      },
      {
        id: 'connectors',
        label: 'Connectors',
        state: connectors.some((item) => item.mode === 'live') ? 'online' : 'standby',
        detail: `${connectors.filter((item) => item.mode !== 'planned').length} of ${connectors.length} reachable`,
      },
      {
        id: 'data',
        label: 'Data layer',
        state: 'online',
        detail: `${config.dataSource} · ${meta.counts?.issues ?? 0} events`,
      },
      {
        id: 'narration',
        label: 'Narration',
        state: llmEnabled() ? 'online' : 'standby',
        detail: llmEnabled() ? config.llm.model : 'Deterministic templates',
      },
      {
        id: 'voice',
        label: 'Voice',
        state: 'online',
        detail: 'Wake phrase, browser speech',
      },
    ];

    // ---- live production feed --------------------------------------------
    // Ordered by what a manager would want shouted first.
    const feed = [];

    // One line per distinct problem. Two rows reading "E-8150 Door seal not
    // seated" tells a manager nothing the first row did not - the count
    // belongs in the row, not in the repetition.
    const criticalByCode = new Map();
    for (const issue of criticalIssues) {
      const existing = criticalByCode.get(issue.errorCode);
      if (existing) existing.count += 1;
      else criticalByCode.set(issue.errorCode, { issue, count: 1 });
    }

    for (const { issue, count } of [...criticalByCode.values()].slice(0, 2)) {
      feed.push({
        id: `feed-${issue.errorCode}`,
        tag: 'CRITICAL',
        tone: 'critical',
        title: `${issue.errorCode} ${issue.errorDescription}`,
        detail:
          count > 1
            ? `${count} vehicles today · latest on ${labelFor('lineId', issue.lineId)}`
            : `${labelFor('lineId', issue.lineId)} · ${labelFor('modelId', issue.modelId)}`,
        at: issue.detectedAt,
        count,
        question: `What problems did we have with ${issue.errorCode} today?`,
      });
    }

    if (dayImpact.removed > 0) {
      feed.push({
        id: 'feed-removed',
        tag: 'REWORK',
        tone: 'serious',
        title: `${dayImpact.removed} vehicles removed from the line`,
        detail: `${dayImpact.reworked} reworked of ${dayImpact.affected} affected`,
        at: null,
        question: 'How many vehicles were removed from the line today?',
      });
    }

    // The top code is only worth its own row when it is not already shouted as
    // a critical row above; otherwise it repeats the same problem.
    const topCode = dayByErrorCode[0];
    if (topCode && !criticalByCode.has(topCode.key)) {
      feed.push({
        id: 'feed-top-code',
        tag: 'TREND',
        tone: 'info',
        title: `${labelFor('errorCode', topCode.key)}`,
        detail: `${topCode.count} occurrences today, the most frequent code`,
        at: null,
        question: 'Which error codes occurred today?',
      });
    }

    if (openTickets.length > 0) {
      feed.push({
        id: 'feed-maintenance',
        tag: 'MAINT',
        tone: 'warning',
        title: `${openTickets.length} maintenance tickets still open`,
        detail: openTickets
          .slice(0, 2)
          .map((ticket) => ticket.assetName)
          .join(', '),
        at: openTickets[0].openedAt,
        question: 'What maintenance work is open today?',
      });
    }

    if (dayDowntime[0]) {
      feed.push({
        id: 'feed-downtime',
        tag: 'STOP',
        tone: 'warning',
        title: `${dayDowntime[0].durationMinutes} min stop on ${labelFor('lineId', dayDowntime[0].lineId)}`,
        detail: `${dayDowntime[0].reason} · ${downtimeMinutes} min total today`,
        at: dayDowntime[0].startedAt,
        question: 'How much downtime did we have today?',
      });
    }

    if (dayByLine[0]) {
      feed.push({
        id: 'feed-line',
        tag: 'LINE',
        tone: 'info',
        title: `${labelFor('lineId', dayByLine[0].key)} leads with ${dayByLine[0].count} issues`,
        detail: `${dayByLine.length} lines reporting today`,
        at: null,
        question: `What problems did ${labelFor('lineId', dayByLine[0].key)} have today?`,
      });
    }

    // ---- shift timeline ---------------------------------------------------
    const nowHour = new Date().getHours();
    const timeline = SHIFTS.map((shift) => {
      const bucket = dayByShift.find((entry) => entry.key === shift.id);
      const running =
        shift.id === 'S3'
          ? nowHour >= shift.startHour || nowHour < shift.endHour
          : nowHour >= shift.startHour && nowHour < shift.endHour;

      return {
        shiftId: shift.id,
        name: shift.name,
        window: shift.label,
        issues: bucket?.count ?? 0,
        vehicles: bucket?.vehicles ?? 0,
        reworkMinutes: bucket?.reworkMinutes ?? 0,
        state: running ? 'running' : (bucket?.count ?? 0) > 0 ? 'complete' : 'idle',
        question: `Summarize the ${shift.name.toLowerCase()} today`,
      };
    });

    // ---- gauges -----------------------------------------------------------
    const activeShifts = timeline.filter((shift) => shift.issues > 0).length || 1;
    const availableMinutes = SHIFT_MINUTES * activeShifts * 4; // four lines
    const gauges = [
      {
        key: 'first_pass_yield',
        label: 'First pass yield',
        value: measureValue('first_pass_yield') ?? 0,
        format: 'percent',
        goodHigh: true,
      },
      {
        key: 'rework_share',
        label: 'Vehicles reworked',
        value: dayImpact.affected > 0 ? dayImpact.reworked / dayImpact.affected : 0,
        format: 'percent',
        goodHigh: false,
        detail: `${dayImpact.reworked} of ${dayImpact.affected} affected`,
      },
      {
        key: 'downtime_share',
        label: 'Downtime',
        value: availableMinutes > 0 ? Math.min(1, downtimeMinutes / availableMinutes) : 0,
        format: 'percent',
        goodHigh: false,
        detail: `${downtimeMinutes} min recorded`,
      },
    ];

    // ---- connected systems, as the HUD lists them -------------------------
    const agents = connectors.map((connector) => ({
      id: connector.id,
      name: connector.name,
      state: connector.mode,
      detail: connector.kind,
      capabilities: connector.capabilities,
      openUrl: connector.openUrl,
    }));

    const providers = [
      {
        id: 'narration',
        name: llmEnabled() ? config.llm.model : 'Deterministic narration',
        state: llmEnabled() ? 'connected' : 'local',
      },
      ...connectors.map((connector) => ({
        id: connector.id,
        name: connector.name,
        state: connector.mode === 'live' ? 'connected' : connector.mode,
      })),
    ];

    res.json({
      status: {
        overall: criticalIssues.length > 0 ? 'attention' : 'optimal',
        dataSource: config.dataSource,
        narration: llmEnabled() ? config.llm.model : 'deterministic',
        referenceDate: today,
        generatedAt: new Date().toISOString(),
      },
      core,
      feed,
      agents,
      timeline,
      gauges,
      providers,
      today: {
        issues: dayIssues.length,
        affected: dayImpact.affected,
        reworked: dayImpact.reworked,
        removed: dayImpact.removed,
        reworkMinutes: dayImpact.reworkMinutes,
        downtimeMinutes,
        openTickets: openTickets.length,
        topErrorCodes: dayByErrorCode.map((bucket) => ({
          ...bucket,
          label: labelFor('errorCode', bucket.key),
        })),
        byLine: dayByLine.map((bucket) => ({ ...bucket, label: labelFor('lineId', bucket.key) })),
      },
      trend: { from: periodFrom, to: today, points: trend },
      dataset: meta,
      role: { id: req.access.role, name: req.access.roleName },
      quickCommands: [
        { label: 'Daily summary', question: `Summarize what happened on ${today}` },
        { label: 'Problems today', question: 'What problems did we have today?' },
        { label: 'Rework count', question: 'How many vehicles were reworked today?' },
        { label: 'Downtime', question: 'How much downtime did we have today?' },
      ],
    });
  } catch (error) {
    next(error);
  }
});
