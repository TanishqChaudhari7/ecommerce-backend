import { runner } from 'node-pg-migrate';
import { env } from '../config/env';
import { logger } from '../config/logger';

async function migrate(): Promise<void> {
  await runner({
    databaseUrl: env.databaseUrl,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg) => logger.info(msg),
  });
  logger.info('Migrations applied successfully.');
}

migrate().catch((error) => {
  logger.error('Migration failed', { error });
  process.exit(1);
});
