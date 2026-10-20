import { Router } from 'express';
import { requirePermission } from '../middleware/access.js';
import { recordAudit } from '../security/audit.js';
import { buildDashboard, refreshDashboard } from '../dashboards/builder.js';
import { deleteDashboard, getAllDashboards, getDashboard } from '../dashboards/store.js';
import { localizeDashboard, resolveDashboardText } from '../dashboards/localize.js';
import { normalizeLanguage } from '../agent/i18n.js';

export const dashboardsRouter = Router();

/**
 * Dashboards on request.
 *
 * Reading the list and a dashboard needs a signed-in user (production:read
 * covers the figures); creating and deleting need dashboards:write. A GET of
 * one dashboard recomputes every widget from the repository before answering.
 */

/** GET /api/dashboards?language= - names localized to the viewer's language. */
dashboardsRouter.get('/', requirePermission('production:read'), async (req, res, next) => {
  try {
    const language = req.query.language ? normalizeLanguage(req.query.language) : 'en';
    const items = await Promise.all(
      getAllDashboards().map(async (dashboard) => {
        const text = await resolveDashboardText(dashboard, language);
        return {
          id: dashboard.id,
          title: text.title,
          question: text.question,
          createdAt: dashboard.createdAt,
          createdBy: dashboard.createdBy,
          widgetCount: dashboard.widgets.length,
        };
      }),
    );
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

/** POST /api/dashboards { question?, title?, language? } */
dashboardsRouter.post('/', requirePermission('dashboards:write'), async (req, res, next) => {
  try {
    const question = String(req.body?.question ?? '').trim().slice(0, 600);
    const title = String(req.body?.title ?? '').trim().slice(0, 120);
    if (!question && !title) {
      res.status(400).json({ error: 'request_error', message: 'question or title is required.' });
      return;
    }
    const item = await buildDashboard({
      question: question || title,
      title: title || null,
      language: req.body?.language ? normalizeLanguage(req.body.language) : undefined,
      createdBy: req.access.userId,
    });
    recordAudit({
      access: req.access,
      action: 'dashboard.create',
      resource: item.id,
      outcome: 'ok',
      detail: `${item.title} (${item.widgets.length} widgets)`,
    });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

/** GET /api/dashboards/:id - widget data recomputed from the repository. */
dashboardsRouter.get('/:id', requirePermission('production:read'), async (req, res, next) => {
  try {
    const dashboard = getDashboard(req.params.id);
    if (!dashboard) {
      res.status(404).json({ error: 'not_found', message: 'No such dashboard.' });
      return;
    }
    const language = req.query.language ? normalizeLanguage(req.query.language) : 'en';
    const item = await refreshDashboard(structuredClone(dashboard));
    await localizeDashboard(dashboard, item, language);
    recordAudit({ access: req.access, action: 'dashboard.read', resource: item.id, outcome: 'ok', detail: item.title });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/dashboards/:id */
dashboardsRouter.delete('/:id', requirePermission('dashboards:write'), (req, res) => {
  const removed = deleteDashboard(req.params.id);
  if (!removed) {
    res.status(404).json({ error: 'not_found', message: 'No such dashboard.' });
    return;
  }
  recordAudit({ access: req.access, action: 'dashboard.delete', resource: req.params.id, outcome: 'ok' });
  res.json({ ok: true });
});
