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

// Search pages are cached under search:v{version}:{hash}. Bumping the version makes
// every existing page unreachable in one O(1) INCR; the old pages expire with their
// TTL. Deleting them instead means a SCAN of the whole keyspace on every write, whose
// cost grows with everything else Redis holds (every cached product, rate-limit set).
const SEARCH_VERSION_KEY = 'search:version';

export async function getSearchCacheVersion(): Promise<string> {
  return (await redis.get(SEARCH_VERSION_KEY)) ?? '0';
}

/**
 * Drops the cached copies of the given products and every cached search page, after
 * a write that changed them has committed. Best effort, like publishEvent: the write
 * already happened, so failing the request here would report a committed change as a
 * 500 (and a retried checkout would then find an empty cart). If Redis is down, the
 * stale entries expire with their TTL.
 */
export async function invalidateProductCaches(productIds: string[]): Promise<void> {
  try {
    if (productIds.length > 0) {
      await redis.del(...productIds.map((productId) => `product:${productId}`));
    }
    await redis.incr(SEARCH_VERSION_KEY);
  } catch (error) {
    logger.error('Failed to invalidate product caches', { productIds, error });
  }
}
