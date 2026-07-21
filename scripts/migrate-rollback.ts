import { runner } from 'node-pg-migrate';
import { env } from '../config/env';
import { logger } from '../config/logger';

async function rollback(): Promise<void> {
  await runner({
    databaseUrl: env.databaseUrl,
    dir: 'migrations',
    direction: 'down',
    count: 1,
    migrationsTable: 'pgmigrations',
    log: (msg) => logger.info(msg),
  });
  logger.info('Last migration rolled back successfully.');
}

rollback().catch((error) => {
  logger.error('Migration rollback failed', { error });
  process.exit(1);
});
