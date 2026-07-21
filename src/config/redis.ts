import Redis from 'ioredis';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export const redis = new Redis(env.redisUrl);

redis.on('error', (err) => {
  logger.error('Redis client error', { error: err });
});

export async function deleteKeysByPattern(pattern: string): Promise<void> {
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}
