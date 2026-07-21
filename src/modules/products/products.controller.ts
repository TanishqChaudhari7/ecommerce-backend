import { Request, Response, NextFunction } from 'express';
import { productsService } from './products.service';

export class ProductsController {
  async index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await productsService.ping();
      res.status(501).json({ message: 'Products module not implemented yet', ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const productsController = new ProductsController();
