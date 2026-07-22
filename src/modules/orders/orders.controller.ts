import { Request, Response, NextFunction } from 'express';
import { ordersService } from './orders.service';
import { AppError } from '../../utils/AppError';
import { UpdateOrderStatusBody } from './orders.validation';
import { AccessTokenPayload } from '../auth/auth.types';

function requireUser(req: Request): AccessTokenPayload {
  if (!req.user) {
    throw new AppError(401, 'Missing access token');
  }
  return req.user;
}

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
      requireUser(req);
      const { status } = req.body as UpdateOrderStatusBody;
      const order = await ordersService.updateStatus(req.params.id, status);
      res.status(200).json({ order });
    } catch (error) {
      next(error);
    }
  }
}

export const ordersController = new OrdersController();
