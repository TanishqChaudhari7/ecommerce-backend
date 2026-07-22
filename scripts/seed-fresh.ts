import { pool } from '../src/config/db';
import { seed, ALL_TABLES } from '../seeds/seed';
import { logger } from '../config/logger';

async function seedFresh(): Promise<void> {
  await pool.query(`TRUNCATE TABLE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE;`);
  logger.info('All tables truncated.');
  await seed();
}

seedFresh()
  .then(async () => {
    logger.info('Fresh seed completed successfully.');
    await pool.end();
  })
  .catch(async (error) => {
    logger.error('Seed fresh failed', { error });
    await pool.end();
    process.exit(1);
  });
