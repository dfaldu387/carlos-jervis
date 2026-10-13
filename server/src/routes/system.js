import { Router } from 'express';
import { buildConnectorRegistry } from '../connectors/index.js';
import { catalog } from '../data/catalog.js';
import { toolCatalog } from '../agent/tools/index.js';
import { roleList } from '../security/roles.js';
import { auditStats, listAudit, listEvents } from '../security/audit.js';
import { requirePermission } from '../middleware/access.js';
import { SHIFTS } from '../utils/dates.js';

export const systemRouter = Router();

/** GET /api/catalog - the dimensions the assistant understands. */
systemRouter.get('/catalog', (_req, res) => {
  res.json({
    plant: catalog.plant,
    shifts: SHIFTS,
    lines: catalog.lines,
    models: catalog.models,
    errorCodes: catalog.errorCodes.map(({ code, description, category }) => ({
      code,
      description,
      category,
    })),
    parts: catalog.parts.map(({ id, name }) => ({ id, name })),
    costCenters: catalog.costCenters,
    checkpoints: catalog.checkpoints,
    reworkCategories: catalog.reworkCategories,
    severities: catalog.severities,
  });
});

/** GET /api/sources - connector registry with integration status. */
systemRouter.get('/sources', (_req, res) => {
  res.json({
    connectors: buildConnectorRegistry(),
    tools: toolCatalog(),
    externalApps: catalog.externalApps,
    powerbiReports: catalog.powerbiReports,
  });
});

/** GET /api/roles */
systemRouter.get('/roles', (req, res) => {
  res.json({ roles: roleList(), current: req.access });
});

/** GET /api/suggestions - the question set the prototype answers today. */
systemRouter.get('/suggestions', (_req, res) => {
  res.json({
    groups: [
      {
        title: 'Production problems',
        questions: [
          'What problems did we have on Friday?',
          'What issues happened on Final Assembly 1 yesterday?',
          'Any critical problems this week?',
        ],
      },
      {
        title: 'Shifts and days',
        questions: [
          'Summarize the early shift yesterday',
          'What happened between 14:00 and 22:00 on Thursday?',
          'Which shifts were affected last week?',
        ],
      },
      {
        title: 'Impact and rework',
        questions: [
          'How many vehicles were reworked on Friday?',
          'Which vehicle models were affected this week?',
          'How many vehicles were removed from the line yesterday?',
        ],
      },
      {
        title: 'Causes and sources',
        questions: [
          'Which error codes occurred this week?',
          'Which parts were involved in E-4120?',
          'Which checkpoints detected the issues on Friday?',
          'How much downtime did we have yesterday?',
          'Which Power BI report has the rework figures?',
        ],
      },
    ],
  });
});

/** GET /api/audit - manager only. */
systemRouter.get('/audit', requirePermission('audit:read'), (req, res) => {
  res.json({
    stats: auditStats(),
    entries: listAudit({ limit: Number(req.query.limit ?? 50) }),
    events: listEvents({ limit: Number(req.query.limit ?? 50) }),
  });
});
