import { Request, Response, NextFunction } from 'express';
import { inventoryService } from './inventory.service';
import { requireUser } from '../../utils/requireUser';
import { UpdateInventoryBody } from './inventory.validation';

export class InventoryController {
  async updateStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const { totalStock } = req.body as UpdateInventoryBody;
      const inventory = await inventoryService.updateStock(
        req.params.productId,
        user.userId,
        user.role,
        totalStock,
      );
      res.status(200).json({ inventory });
    } catch (error) {
      next(error);
    }
  }

  async lowStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const products = await inventoryService.getLowStock(user.userId, user.role);
      res.status(200).json({ products });
    } catch (error) {
      next(error);
    }
  }
}

export const inventoryController = new InventoryController();
