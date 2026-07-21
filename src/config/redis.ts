import Redis from 'ioredis';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export const redis = new Redis(env.redisUrl);

redis.on('error', (err) => {
  logger.error('Redis client error', { error: err });
});
