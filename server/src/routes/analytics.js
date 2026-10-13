import { Router } from 'express';
import { getRepository } from '../data/index.js';
import { LINES } from '../data/catalog.js';
import { labelFor } from '../agent/labels.js';
import { addDays, now, toIsoDate } from '../utils/dates.js';

export const analyticsRouter = Router();

const AREA_BY_LINE = Object.fromEntries(LINES.map((line) => [line.id, line.area]));
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

/**
 * GET /api/analytics
 * Aggregates for the Analytics page: a daily trend, counts by severity, by
 * production area and by error code, plus a short chronological event list.
 * Every series is a real aggregate of the active data source - nothing is
 * smoothed or projected.
 */
analyticsRouter.get('/', async (req, res, next) => {
  try {
    const repository = getRepository();
    const days = Math.min(28, Math.max(1, Number(req.query.days ?? 14)));
    const to = toIsoDate(now());
    const from = toIsoDate(addDays(now(), -(days - 1)));
    const filter = { from, to };
    if (['low', 'medium', 'high', 'critical'].includes(req.query.severity)) {
      filter.severity = req.query.severity;
    }
    if (req.query.area) {
      const line = LINES.find((entry) => entry.id === req.query.area || entry.area === req.query.area);
      if (line) filter.lineId = line.id;
    }

    const [trend, bySeverity, byLine, byErrorCode, downtime] = await Promise.all([
      repository.dailyTrend(filter),
      repository.aggregateIssues(filter, 'severity'),
      repository.aggregateIssues(filter, 'lineId'),
      repository.aggregateIssues({ ...filter, limit: 8 }, 'errorCode'),
      repository.listDowntime({ ...filter, limit: 12 }),
    ]);

    // Fold line counts up to production areas.
    const areaTotals = new Map();
    for (const bucket of byLine) {
      const area = AREA_BY_LINE[bucket.key] ?? bucket.key;
      areaTotals.set(area, (areaTotals.get(area) ?? 0) + bucket.count);
    }

    res.json({
      period: { from, to, days },
      trend,
      bySeverity: SEVERITY_ORDER.map((key) => ({
        key,
        label: key[0].toUpperCase() + key.slice(1),
        count: bySeverity.find((bucket) => bucket.key === key)?.count ?? 0,
      })),
      byArea: [...areaTotals.entries()]
        .map(([area, count]) => ({ key: area, label: area, count }))
        .sort((a, b) => b.count - a.count),
      byErrorCode: byErrorCode.map((bucket) => ({ ...bucket, label: labelFor('errorCode', bucket.key) })),
      events: downtime
        .map((event) => ({
          at: event.startedAt,
          lineId: event.lineId,
          label: `${labelFor('lineId', event.lineId)} — ${event.reason}`,
          durationMinutes: event.durationMinutes,
        }))
        .sort((a, b) => (a.at < b.at ? 1 : -1)),
    });
  } catch (error) {
    next(error);
  }
});
