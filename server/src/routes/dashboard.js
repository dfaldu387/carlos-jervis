import { Router } from 'express';
import { getRepository } from '../data/index.js';
import { LINES } from '../data/catalog.js';
import { buildConnectorRegistry } from '../connectors/index.js';
import { listEvents } from '../security/audit.js';
import { addDays, now, toIsoDate } from '../utils/dates.js';

export const dashboardRouter = Router();

const AREA_BY_LINE = Object.fromEntries(LINES.map((line) => [line.id, line.area]));
const LINE_NAME = Object.fromEntries(LINES.map((line) => [line.id, line.name]));

/**
 * GET /api/dashboard
 * The Overview page in one call: KPI cards (with a real previous-period
 * comparison where the data supports it), the activity trend, the issue
 * breakdown by severity and status, recent issues, recent activity and the
 * source health list. Each number is an actual count; the labels say what each
 * one means so nothing is left to guess.
 */
dashboardRouter.get('/', async (req, res, next) => {
  try {
    const repository = getRepository();
    const days = Math.min(28, Math.max(1, Number(req.query.days ?? 14)));
    const to = toIsoDate(now());
    const from = toIsoDate(addDays(now(), -(days - 1)));
    const prevTo = toIsoDate(addDays(now(), -days));
    const prevFrom = toIsoDate(addDays(now(), -(days * 2 - 1)));
    const period = { from, to };
    const previous = { from: prevFrom, to: prevTo };

    const [
      openNow,
      openPrev,
      criticalNow,
      bySeverity,
      byStatus,
      trend,
      recentIssues,
      downtime,
      maintenance,
      inProgress,
      meta,
    ] = await Promise.all([
      repository.countIssues({ ...period, status: 'open' }),
      repository.countIssues({ ...previous, status: 'open' }),
      repository.countIssues({ ...period, severity: 'critical' }),
      repository.aggregateIssues(period, 'severity'),
      repository.aggregateIssues(period, 'status'),
      repository.dailyTrend(period),
      repository.listIssues({ ...period, limit: 6 }),
      repository.listDowntime({ ...period, limit: 100 }),
      repository.listMaintenance({ ...period, limit: 100 }),
      repository.countIssues({ ...period, status: 'in_progress' }),
      repository.meta(),
    ]);

    const connectors = buildConnectorRegistry();
    const openTickets = maintenance.filter((ticket) => ticket.status === 'open').length;

    const statusLabel = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
    const severityLabel = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

    res.json({
      period: { from, to, days },
      generatedAt: new Date().toISOString(),
      referenceDate: meta.referenceDate ?? to,
      kpis: {
        openIssues: {
          label: 'Open issues',
          value: openNow,
          previous: openPrev,
          delta: openNow - openPrev,
          help: `Issues still open, last ${days} days`,
          to: 'issues?status=open',
        },
        criticalIssues: {
          label: 'Critical issues',
          value: criticalNow,
          help: `Critical severity, last ${days} days`,
          to: 'issues?severity=critical',
        },
        productionEvents: {
          label: 'Production events',
          value: downtime.length + maintenance.length,
          help: `Downtime and maintenance events, last ${days} days`,
          to: 'analytics',
        },
        unresolvedItems: {
          label: 'Unresolved items',
          value: openNow + inProgress + openTickets,
          help: 'Open or in-progress issues plus open maintenance',
          to: 'issues?status=open',
        },
        connectedSources: {
          label: 'Connected sources',
          value: connectors.filter((item) => item.mode === 'live').length,
          total: connectors.filter((item) => item.mode !== 'planned').length,
          help: 'Live connectors out of those available',
          to: 'sources',
        },
      },
      activityTrend: trend,
      issueBreakdown: {
        bySeverity: bySeverity.map((bucket) => ({
          key: bucket.key,
          label: severityLabel[bucket.key] ?? bucket.key,
          count: bucket.count,
        })),
        byStatus: byStatus.map((bucket) => ({
          key: bucket.key,
          label: statusLabel[bucket.key] ?? bucket.key,
          count: bucket.count,
        })),
      },
      recentIssues: recentIssues.map((row) => ({
        id: row.id,
        title: `${row.errorCode} · ${row.errorDescription}`,
        severity: row.severity,
        status: row.status,
        area: AREA_BY_LINE[row.lineId] ?? row.lineId,
        lineName: LINE_NAME[row.lineId] ?? row.lineId,
        reportedAt: row.detectedAt,
      })),
      recentActivity: req.access.permissions.includes('audit:read')
        ? listEvents({ limit: 6 })
        : [],
      sourceHealth: connectors.map((connector) => ({
        id: connector.id,
        name: connector.name,
        mode: connector.mode,
        lastCheck: connector.lastCheck,
      })),
    });
  } catch (error) {
    next(error);
  }
});
