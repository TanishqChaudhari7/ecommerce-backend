import { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger';
import { env } from '../../config/env';

export interface HttpError extends Error {
  statusCode?: number;
}

export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;

  logger.error(err.message, { stack: err.stack, path: req.originalUrl, method: req.method });

  res.status(statusCode).json({
    message: statusCode === 500 && env.isProduction ? 'Internal server error' : err.message,
    ...(env.isProduction ? {} : { stack: err.stack }),
  });
}
