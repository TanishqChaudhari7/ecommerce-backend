import { Request, Response, NextFunction } from 'express';
import { ordersService } from './orders.service';

export class OrdersController {
  async index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await ordersService.ping();
      res.status(501).json({ message: 'Orders module not implemented yet', ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const ordersController = new OrdersController();
