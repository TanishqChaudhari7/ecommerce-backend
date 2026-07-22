import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { AppError } from '../../utils/AppError';
import { RegisterBody, LoginBody, RefreshBody, LogoutBody } from './auth.validation';

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as RegisterBody;
      const user = await authService.register(body);
      res.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as LoginBody;
      const result = await authService.login(email, password);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body as RefreshBody;
      const result = await authService.refresh(refreshToken);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body as LogoutBody;
      await authService.logout(refreshToken);
      res.status(200).json({ message: 'Logged out' });
    } catch (error) {
      next(error);
    }
  }

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Missing access token');
      }
      const user = await authService.getMe(req.user.userId);
      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
