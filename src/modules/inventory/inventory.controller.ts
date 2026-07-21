import { Request, Response, NextFunction } from 'express';
import { inventoryService } from './inventory.service';
import { AppError } from '../../utils/AppError';
import { UpdateInventoryBody } from './inventory.validation';

export class InventoryController {
  async updateStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Missing access token');
      }
      const { totalStock } = req.body as UpdateInventoryBody;
      const inventory = await inventoryService.updateStock(
        req.params.productId,
        req.user.userId,
        req.user.role,
        totalStock,
      );
      res.status(200).json({ inventory });
    } catch (error) {
      next(error);
    }
  }

  async lowStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'Missing access token');
      }
      const products = await inventoryService.getLowStock(req.user.userId, req.user.role);
      res.status(200).json({ products });
    } catch (error) {
      next(error);
    }
  }
}

export const inventoryController = new InventoryController();
