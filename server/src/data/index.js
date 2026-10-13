import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { MemoryRepository } from './adapters/memory.adapter.js';
import { PostgresRepository } from './adapters/postgres.adapter.js';
import { DatabricksRepository } from './adapters/databricks.adapter.js';

let repository = null;

/** Single place where the data source is chosen. */
export const getRepository = () => {
  if (repository) return repository;

  switch (config.dataSource) {
    case 'postgres':
      logger.info('Data layer: postgres adapter selected');
      repository = new PostgresRepository({ connectionString: config.databaseUrl });
      break;
    case 'databricks':
      logger.info('Data layer: databricks SQL warehouse selected');
      repository = new DatabricksRepository();
      break;
    case 'memory':
    default:
      logger.info('Data layer: in-memory synthetic warehouse');
      repository = new MemoryRepository();
      break;
  }

  return repository;
};

export const resetRepository = () => {
  repository = null;
};
