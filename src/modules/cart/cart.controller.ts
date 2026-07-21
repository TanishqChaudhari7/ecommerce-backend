import { Request, Response, NextFunction } from 'express';
import { cartService } from './cart.service';

export class CartController {
  async index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await cartService.ping();
      res.status(501).json({ message: 'Cart module not implemented yet', ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const cartController = new CartController();
