import express from 'express';
import cors from 'cors';
import { config, llmEnabled } from './config.js';
import { attachAccess, requireAuth } from './middleware/access.js';
import { securityHeaders } from './middleware/security.js';
import { errorHandler, notFound, requestLog } from './middleware/errors.js';
import { getRepository } from './data/index.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { summariesRouter } from './routes/summaries.js';
import { systemRouter } from './routes/system.js';
import { voiceRouter } from './routes/voice.js';
import { commandCenterRouter } from './routes/commandCenter.js';
import { integrationsRouter } from './routes/integrations.js';
import { dashboardRouter } from './routes/dashboard.js';
import { issuesRouter } from './routes/issues.js';
import { analyticsRouter } from './routes/analytics.js';
import { conversationsRouter } from './routes/conversations.js';
import { secretaryRouter } from './routes/secretary.js';
import { dashboardsRouter } from './routes/dashboards.js';

export const createApp = () => {
  const app = express();

  app.set('trust proxy', true);
  app.use(securityHeaders);
  app.use(cors({ origin: true, credentials: true, exposedHeaders: ['x-jervis-role'] }));
  app.use(express.json({ limit: '128kb' }));
  app.use(attachAccess);
  app.use(requestLog);

  // Public: health check and the authentication flow.
  app.get('/api/health', async (_req, res, next) => {
    try {
      const meta = await getRepository().meta();
      res.json({
        status: 'ok',
        env: config.env,
        dataSource: config.dataSource,
        narration: llmEnabled() ? `claude:${config.llm.model}` : 'deterministic',
        dataset: meta,
      });
    } catch (error) {
      next(error);
    }
  });
  app.use('/api/auth', authRouter);

  // Everything below requires an authenticated session (deny by default).
  app.use('/api/chat', requireAuth, chatRouter);
  app.use('/api/summaries', requireAuth, summariesRouter);
  app.use('/api/voice', requireAuth, voiceRouter);
  app.use('/api/command-center', requireAuth, commandCenterRouter);
  app.use('/api/dashboard', requireAuth, dashboardRouter);
  app.use('/api/issues', requireAuth, issuesRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/conversations', requireAuth, conversationsRouter);
  app.use('/api/integrations', requireAuth, integrationsRouter);
  app.use('/api/secretary', requireAuth, secretaryRouter);
  app.use('/api/dashboards', requireAuth, dashboardsRouter);
  app.use('/api', requireAuth, systemRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};
