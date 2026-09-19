import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

// Prune, count and record run as one script so concurrent requests can't all read a
// count below the limit before any of them records itself. Returns -1 when the
// request is admitted, otherwise the timestamp of the oldest request in the window.
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
if redis.call('ZCARD', key) >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return tonumber(oldest[2]) or now
end

redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return -1
`;

export function rateLimit({ windowMs, max, keyPrefix }: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `ratelimit:${keyPrefix}:${req.ip}`;
    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2)}`;

    try {
      const oldestTimestamp = Number(
        await redis.eval(SLIDING_WINDOW_SCRIPT, 1, key, now, windowMs, max, member),
      );

      if (oldestTimestamp >= 0) {
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

        res.setHeader('Retry-After', retryAfterSeconds.toString());
        res.status(429).json({
          message: 'Too many requests, please try again later.',
          retryAfterSeconds,
        });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
