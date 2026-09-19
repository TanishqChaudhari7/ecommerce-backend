import { Request } from 'express';
import { AppError } from './AppError';
import { AccessTokenPayload } from '../modules/auth/auth.types';

/**
 * Returns the authenticated user for a route mounted behind `authenticateToken`.
 * The check only fails if a route is wired without that middleware, and narrows
 * `req.user` from `AccessTokenPayload | undefined` for the controller.
 */
export function requireUser(req: Request): AccessTokenPayload {
  if (!req.user) {
    throw new AppError(401, 'Missing access token');
  }
  return req.user;
}
