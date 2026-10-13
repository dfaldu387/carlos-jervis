import { Router } from 'express';
import { publicView, saveSettings, recordCheck } from '../integrations/store.js';
import { testConnection } from '../integrations/probe.js';
import { buildConnectorRegistry } from '../connectors/index.js';
import { requirePermission } from '../middleware/access.js';
import { recordAudit } from '../security/audit.js';

export const integrationsRouter = Router();

/**
 * Integration administration.
 *
 * Every route is behind the integrations:manage permission - configuring a
 * connector exposes endpoints and triggers outbound calls, so it is a manager
 * action enforced on the server, not a UI toggle. Secrets are never returned;
 * the store's public view masks them.
 */
integrationsRouter.use(requirePermission('integrations:manage'));

/** GET /api/integrations - connector config (secrets masked) plus live status. */
integrationsRouter.get('/', (_req, res) => {
  const registry = buildConnectorRegistry();
  const settings = publicView().map((entry) => ({
    ...entry,
    mode: registry.find((item) => item.id === entry.id)?.mode ?? 'mock',
  }));
  res.json({ integrations: settings });
});

/** PUT /api/integrations/:id - save credentials and the enabled flag. */
integrationsRouter.put('/:id', (req, res, next) => {
  try {
    const updated = saveSettings(
      req.params.id,
      { values: req.body?.values ?? {}, enabled: req.body?.enabled },
      req.access.userId,
    );
    const mode = buildConnectorRegistry().find((item) => item.id === req.params.id)?.mode ?? 'mock';
    recordAudit({
      access: req.access,
      action: 'integration.update',
      resource: req.params.id,
      outcome: 'ok',
      detail: req.body?.enabled === true ? 'enabled' : req.body?.enabled === false ? 'disabled' : 'saved',
    });
    res.json({ integration: { ...updated, mode } });
  } catch (error) {
    next(error);
  }
});

/** POST /api/integrations/:id/test - run the connection probe now. */
integrationsRouter.post('/:id/test', async (req, res, next) => {
  try {
    const result = await testConnection(req.params.id);
    if (result.mode === 'live') recordCheck(req.params.id, result);
    recordAudit({
      access: req.access,
      action: 'integration.test',
      resource: req.params.id,
      outcome: result.ok ? 'ok' : 'failed',
      detail: result.detail,
    });
    res.json({ result });
  } catch (error) {
    next(error);
  }
});
