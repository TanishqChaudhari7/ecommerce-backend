import { Request, Response, NextFunction } from 'express';
import { cartService } from './cart.service';
import { AppError } from '../../utils/AppError';
import { AddCartItemBody, UpdateCartItemBody } from './cart.validation';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError(401, 'Missing access token');
  }
  return req.user.userId;
}

export class CartController {
  async getCart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cart = await cartService.getCart(requireUserId(req));
      res.status(200).json({ cart });
    } catch (error) {
      next(error);
    }
  }

  async addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productId, quantity } = req.body as AddCartItemBody;
      const cart = await cartService.addItem(requireUserId(req), productId, quantity);
      res.status(201).json({ cart });
    } catch (error) {
      next(error);
    }
  }

  async updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { quantity } = req.body as UpdateCartItemBody;
      const cart = await cartService.updateItem(requireUserId(req), req.params.productId, quantity);
      res.status(200).json({ cart });
    } catch (error) {
      next(error);
    }
  }

  async removeItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cart = await cartService.removeItem(requireUserId(req), req.params.productId);
      res.status(200).json({ cart });
    } catch (error) {
      next(error);
    }
  }

  async clearCart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await cartService.clearCart(requireUserId(req));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const cartController = new CartController();
