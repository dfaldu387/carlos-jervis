import { Router } from 'express';
import { getRepository } from '../data/index.js';
import { LINES, ERROR_CODES, CHECKPOINTS, PARTS } from '../data/catalog.js';
import { SOURCE_LABELS } from '../connectors/index.js';
import { addDays, now, toIsoDate } from '../utils/dates.js';

export const issuesRouter = Router();

const AREA_BY_LINE = Object.fromEntries(LINES.map((line) => [line.id, line.area]));
const LINE_NAME = Object.fromEntries(LINES.map((line) => [line.id, line.name]));
const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

/** Columns a client is allowed to sort by - an allowlist, never raw input. */
const SORT_COLUMNS = {
  reportedAt: (row) => row.detectedAt,
  severity: (row) => SEVERITY_RANK[row.severity] ?? -1,
  status: (row) => row.status,
  area: (row) => AREA_BY_LINE[row.lineId] ?? '',
};

const toView = (row) => ({
  id: row.id,
  title: `${row.errorCode} · ${row.errorDescription}`,
  errorCode: row.errorCode,
  description: row.symptom,
  severity: row.severity,
  status: row.status,
  area: AREA_BY_LINE[row.lineId] ?? row.lineId,
  lineId: row.lineId,
  lineName: LINE_NAME[row.lineId] ?? row.lineId,
  reportedAt: row.detectedAt,
  date: row.date,
  modelId: row.modelId,
  vin: row.vin,
  partId: row.partId,
  checkpointId: row.checkpointId,
  reworkMinutes: row.reworkMinutes,
  vehicleRemoved: row.vehicleRemoved,
});

/** Build the repository filter from validated query parameters. */
const filterFromQuery = (query) => {
  const filter = {};
  const to = query.to ?? toIsoDate(now());
  const from = query.from ?? toIsoDate(addDays(now(), -27));
  filter.from = from;
  filter.to = to;
  if (['low', 'medium', 'high', 'critical'].includes(query.severity)) filter.severity = query.severity;
  if (['open', 'in_progress', 'resolved'].includes(query.status)) filter.status = query.status;
  if (query.area) {
    // Accept either a line id or an area name.
    const line = LINES.find((entry) => entry.id === query.area || entry.area === query.area);
    if (line) filter.lineId = line.id;
  }
  if (query.lineId && LINES.some((entry) => entry.id === query.lineId)) filter.lineId = query.lineId;
  return filter;
};

/**
 * GET /api/issues
 * Searchable, filterable, sortable, paginated issue list plus the summary
 * counts the page header shows. Pagination and sort are bounded and validated.
 */
issuesRouter.get('/', async (req, res, next) => {
  try {
    const repository = getRepository();
    const filter = filterFromQuery(req.query);

    const all = (await repository.listIssues(filter)).map(toView);

    const search = String(req.query.q ?? '').trim().toLowerCase();
    const matched = search
      ? all.filter(
          (row) =>
            row.title.toLowerCase().includes(search) ||
            row.id.toLowerCase().includes(search) ||
            row.description.toLowerCase().includes(search),
        )
      : all;

    const sortKey = SORT_COLUMNS[req.query.sort] ? req.query.sort : 'reportedAt';
    const dir = req.query.dir === 'asc' ? 1 : -1;
    const getKey = SORT_COLUMNS[sortKey];
    const sorted = [...matched].sort((a, b) => {
      const av = getKey(a);
      const bv = getKey(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize ?? 15)));
    const start = (page - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize);

    res.json({
      items,
      total: sorted.length,
      page,
      pageSize,
      sort: sortKey,
      dir: dir === 1 ? 'asc' : 'desc',
      summary: {
        total: all.length,
        critical: all.filter((row) => row.severity === 'critical').length,
        open: all.filter((row) => row.status === 'open').length,
        resolved: all.filter((row) => row.status === 'resolved').length,
      },
      areas: LINES.map((line) => ({ id: line.id, name: line.name, area: line.area })),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/issues/:id - one issue with its context and related events. */
issuesRouter.get('/:id', async (req, res, next) => {
  try {
    const repository = getRepository();
    const all = await repository.listIssues({ from: toIsoDate(addDays(now(), -27)), to: toIsoDate(now()) });
    const row = all.find((entry) => entry.id === req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'No issue with that id in the current window.' });
      return;
    }

    const issue = toView(row);
    const errorMeta = ERROR_CODES.find((entry) => entry.code === row.errorCode) ?? null;
    const part = PARTS.find((entry) => entry.id === row.partId) ?? null;
    const checkpoint = CHECKPOINTS.find((entry) => entry.id === row.checkpointId) ?? null;

    // Other findings on the same vehicle, and work on the same line that day.
    const sameVehicle = all
      .filter((entry) => entry.vin === row.vin && entry.id !== row.id)
      .map(toView);
    const [maintenance, downtime] = await Promise.all([
      repository.listMaintenance({ from: row.date, to: row.date, lineId: row.lineId, limit: 10 }),
      repository.listDowntime({ from: row.date, to: row.date, lineId: row.lineId, limit: 10 }),
    ]);

    const timeline = [
      { at: row.detectedAt, kind: 'detected', label: `Detected at ${checkpoint?.name ?? 'checkpoint'}` },
      ...downtime.map((event) => ({
        at: event.startedAt,
        kind: 'downtime',
        label: `${event.durationMinutes} min stop — ${event.reason}`,
      })),
      ...maintenance.map((ticket) => ({
        at: ticket.openedAt,
        kind: 'maintenance',
        label: `Maintenance ${ticket.status} — ${ticket.description}`,
      })),
    ].sort((a, b) => (a.at < b.at ? -1 : 1));

    res.json({
      issue,
      detail: {
        category: errorMeta?.category ?? null,
        symptom: errorMeta?.symptom ?? row.symptom,
        part: part ? { id: part.id, name: part.name, supplier: part.supplier } : null,
        checkpoint: checkpoint ? { id: checkpoint.id, name: checkpoint.name } : null,
      },
      timeline,
      related: { vehicle: sameVehicle, maintenance, downtime },
      sources: [
        { source: 'databricks', label: SOURCE_LABELS.databricks, object: 'prod_quality.issue_events' },
        ...(maintenance.length
          ? [{ source: 'integral_portal', label: SOURCE_LABELS.integral_portal, object: 'maintenance.tickets' }]
          : []),
        ...(downtime.length ? [{ source: 'mqtt', label: SOURCE_LABELS.mqtt, object: 'plant1/+/+/state' }] : []),
      ],
    });
  } catch (error) {
    next(error);
  }
});
