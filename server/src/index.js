import { createApp } from './app.js';
import { config, llmEnabled } from './config.js';
import { getRepository } from './data/index.js';
import { logger } from './utils/logger.js';

const start = async () => {
  const repository = getRepository();
  const meta = await repository.meta();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`Jervis API listening on http://localhost:${config.port}`);
    logger.info(`Narration: ${llmEnabled() ? `claude (${config.llm.model})` : 'deterministic templates'}`);
    if (meta.counts) {
      logger.info(
        `Dataset: ${meta.counts.issues} issues, ${meta.counts.maintenanceTickets} maintenance tickets, ` +
          `${meta.counts.downtimeEvents} downtime events, reference date ${meta.referenceDate}`,
      );
    }
  });
};

start().catch((error) => {
  logger.error('Failed to start Jervis API', { error: error.message });
  process.exitCode = 1;
});
