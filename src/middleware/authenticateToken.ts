import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../utils/AppError';
import { AccessTokenPayload } from '../modules/auth/auth.types';

export function authenticateToken(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    next(new AppError(401, 'Missing access token'));
    return;
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired access token'));
  }
}
