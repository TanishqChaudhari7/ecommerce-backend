import { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} - ${durationMs.toFixed(1)}ms`);
  });

  next();
}
