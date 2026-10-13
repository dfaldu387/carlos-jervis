import { Router } from 'express';
import { answerQuestion } from '../agent/orchestrator.js';
import { getRepository } from '../data/index.js';
import { fetchMeasures } from '../connectors/powerbi.connector.js';
import { labelFor } from '../agent/labels.js';
import { SHIFTS, addDays, now, toIsoDate } from '../utils/dates.js';
import { recordQuery } from '../security/audit.js';

export const summariesRouter = Router();

/**
 * GET /api/summaries/daily?date=YYYY-MM-DD[&line=FA1]
 *
 * The scheduled-summary use case from the requirements: the same answer the
 * chat produces, reachable without asking a question so it can be mailed or
 * posted on a schedule later.
 */
summariesRouter.get('/daily', async (req, res, next) => {
  try {
    const date = req.query.date ?? toIsoDate(now());
    const line = req.query.line ? ` on ${labelFor('lineId', req.query.line)}` : '';
    const result = await answerQuestion({
      question: `Summarize what happened on ${date}${line}`,
      access: req.access,
    });
    recordQuery({ question: result.question, access: req.access, result });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** GET /api/summaries/shift?date=YYYY-MM-DD&shift=S1 */
summariesRouter.get('/shift', async (req, res, next) => {
  try {
    const date = req.query.date ?? toIsoDate(now());
    const shift = SHIFTS.find((entry) => entry.id === req.query.shift) ?? SHIFTS[0];
    const result = await answerQuestion({
      question: `Summarize the ${shift.name.toLowerCase()} on ${date}`,
      access: req.access,
    });
    recordQuery({ question: result.question, access: req.access, result });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/summaries/overview?days=14
 *
 * Feeds the dashboard view: KPI tiles, the daily trend, and the per-shift and
 * per-line split for the period.
 */
summariesRouter.get('/overview', async (req, res, next) => {
  try {
    const days = Math.min(28, Math.max(1, Number(req.query.days ?? 14)));
    const to = toIsoDate(now());
    const from = toIsoDate(addDays(now(), -(days - 1)));
    const filter = { from, to, ...(req.query.line ? { lineId: req.query.line } : {}) };

    const repository = getRepository();
    const [trend, byShift, byLine, byErrorCode, impact, measures, meta] = await Promise.all([
      repository.dailyTrend(filter),
      repository.aggregateIssues(filter, 'shiftId'),
      repository.aggregateIssues(filter, 'lineId'),
      repository.aggregateIssues({ ...filter, limit: 6 }, 'errorCode'),
      repository.vehicleImpact(filter),
      fetchMeasures(filter, { includeRestricted: req.access.permissions.includes('finance:read') }),
      repository.meta(),
    ]);

    res.json({
      period: { from, to, days },
      dataset: meta,
      impact,
      measures: measures.measures,
      trend,
      byShift: byShift.map((bucket) => ({ ...bucket, label: labelFor('shiftId', bucket.key) })),
      byLine: byLine.map((bucket) => ({ ...bucket, label: labelFor('lineId', bucket.key) })),
      byErrorCode: byErrorCode.map((bucket) => ({ ...bucket, label: labelFor('errorCode', bucket.key) })),
      shifts: SHIFTS,
    });
  } catch (error) {
    next(error);
  }
});
