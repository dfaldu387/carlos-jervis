import { createApp } from './app.js';
import { config, llmEnabled } from './config.js';
import { getRepository } from './data/index.js';
import { setAuditSink, hydrateAudit } from './security/audit.js';
import { PostgresAuditSink } from './security/audit-sink.js';
import { logger } from './utils/logger.js';

const start = async () => {
  const repository = getRepository();
  const meta = await repository.meta();

  // Durable audit trail: when a Postgres connection is configured, mirror the
  // audit log to the database and restore the recent trail from it on boot.
  if (config.dataSource === 'postgres' && config.databaseUrl) {
    setAuditSink(new PostgresAuditSink({ connectionString: config.databaseUrl }));
    await hydrateAudit();
    logger.info('Audit trail: durable (postgres)');
  }

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
