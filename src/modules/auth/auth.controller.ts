import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';

export class AuthController {
  async index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.ping();
      res.status(501).json({ message: 'Auth module not implemented yet', ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
