import { Request, Response, NextFunction } from 'express';
import { inventoryService } from './inventory.service';

export class InventoryController {
  async index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await inventoryService.ping();
      res.status(501).json({ message: 'Inventory module not implemented yet', ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const inventoryController = new InventoryController();
