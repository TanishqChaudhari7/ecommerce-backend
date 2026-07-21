import { Request, Response, NextFunction } from 'express';
import { paymentsService } from './payments.service';

export class PaymentsController {
  async index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await paymentsService.ping();
      res.status(501).json({ message: 'Payments module not implemented yet', ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const paymentsController = new PaymentsController();
