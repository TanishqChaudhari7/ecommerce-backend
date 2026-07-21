import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

export function rateLimit({ windowMs, max, keyPrefix }: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `ratelimit:${keyPrefix}:${req.ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      await redis.zremrangebyscore(key, 0, windowStart);
      const count = await redis.zcard(key);

      if (count >= max) {
        const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
        const oldestTimestamp = oldest.length > 0 ? Number(oldest[1]) : now;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

        res.setHeader('Retry-After', retryAfterSeconds.toString());
        res.status(429).json({
          message: 'Too many requests, please try again later.',
          retryAfterSeconds,
        });
        return;
      }

      await redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
      await redis.pexpire(key, windowMs);

      next();
    } catch (error) {
      next(error);
    }
  };
}
