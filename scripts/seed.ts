import { pool } from '../src/config/db';
import { seed } from '../seeds/seed';
import { logger } from '../config/logger';

seed()
  .then(async () => {
    logger.info('Seed completed successfully.');
    await pool.end();
  })
  .catch(async (error) => {
    logger.error('Seed failed', { error });
    await pool.end();
    process.exit(1);
  });
