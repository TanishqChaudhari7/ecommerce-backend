import { Request, Response, NextFunction } from 'express';
import { productsService } from './products.service';
import { AppError } from '../../utils/AppError';
import { ListProductsQuery, CreateProductBody, UpdateProductBody } from './products.validation';

export class ProductsController {
  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit } = res.locals.query as ListProductsQuery;
      const result = await productsService.listProducts(page, limit);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await productsService.getProductById(req.params.id);
      res.status(200).json({ product });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Missing access token');
      }
      const body = req.body as CreateProductBody;
      const product = await productsService.createProduct(req.user.userId, body);
      res.status(201).json({ product });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Missing access token');
      }
      const body = req.body as UpdateProductBody;
      const product = await productsService.updateProduct(req.params.id, req.user.userId, body);
      res.status(200).json({ product });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Missing access token');
      }
      await productsService.deleteProduct(req.params.id, req.user.userId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const productsController = new ProductsController();
