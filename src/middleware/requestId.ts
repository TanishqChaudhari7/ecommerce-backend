import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { runWithRequestId } from '../utils/requestContext';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  runWithRequestId(id, next);
}
