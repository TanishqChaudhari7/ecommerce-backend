import { Request, Response, NextFunction } from 'express';
import { cartService } from './cart.service';
import { requireUser } from '../../utils/requireUser';
import { AddCartItemBody, UpdateCartItemBody } from './cart.validation';

export class CartController {
  async getCart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cart = await cartService.getCart(requireUser(req).userId);
      res.status(200).json({ cart });
    } catch (error) {
      next(error);
    }
  }

  async addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productId, quantity } = req.body as AddCartItemBody;
      const cart = await cartService.addItem(requireUser(req).userId, productId, quantity);
      res.status(201).json({ cart });
    } catch (error) {
      next(error);
    }
  }

  async updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { quantity } = req.body as UpdateCartItemBody;
      const cart = await cartService.updateItem(
        requireUser(req).userId,
        req.params.productId,
        quantity,
      );
      res.status(200).json({ cart });
    } catch (error) {
      next(error);
    }
  }

  async removeItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cart = await cartService.removeItem(requireUser(req).userId, req.params.productId);
      res.status(200).json({ cart });
    } catch (error) {
      next(error);
    }
  }

  async clearCart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await cartService.clearCart(requireUser(req).userId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const cartController = new CartController();
