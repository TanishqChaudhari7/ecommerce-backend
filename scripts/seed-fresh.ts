import { logger } from '../config/logger';

async function seedFresh(): Promise<void> {
  logger.info('Fresh seeding (reset + seed) will be implemented in Step 2 (Database & Seed).');
}

seedFresh().catch((error) => {
  logger.error('Seed fresh failed', { error });
  process.exit(1);
});
