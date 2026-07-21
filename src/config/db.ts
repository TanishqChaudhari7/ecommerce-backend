import { Pool } from 'pg';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client', { error: err });
});
