import { logger } from '../config/logger';

async function seed(): Promise<void> {
  logger.info('Seeding will be implemented in Step 2 (Database & Seed).');
}

seed().catch((error) => {
  logger.error('Seed failed', { error });
  process.exit(1);
});
