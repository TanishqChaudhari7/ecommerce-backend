import { Request, Response, NextFunction } from 'express';
import { ordersService } from './orders.service';
import { requireUser } from '../../utils/requireUser';
import { UpdateOrderStatusBody } from './orders.validation';

export class OrdersController {
  async placeOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const order = await ordersService.placeOrder(user.userId);
      res.status(201).json({ order });
    } catch (error) {
      next(error);
    }
  }

  async listOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const orders = await ordersService.listOrders(user.userId, user.role);
      res.status(200).json({ orders });
    } catch (error) {
      next(error);
    }
  }

  async getOrderById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const order = await ordersService.getOrderById(req.params.id, user.userId, user.role);
      res.status(200).json({ order });
    } catch (error) {
      next(error);
    }
  }

  async cancelOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const order = await ordersService.cancelOrder(req.params.id, user.userId);
      res.status(200).json({ order });
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status } = req.body as UpdateOrderStatusBody;
      const order = await ordersService.updateStatus(req.params.id, status);
      res.status(200).json({ order });
    } catch (error) {
      next(error);
    }
  }
}

export const ordersController = new OrdersController();
