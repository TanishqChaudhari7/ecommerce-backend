import { Request, Response, NextFunction } from 'express';
import { paymentsService } from './payments.service';
import { AppError } from '../../utils/AppError';
import { InitiatePaymentBody } from './payments.validation';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError(401, 'Missing access token');
  }
  return req.user.userId;
}

export class PaymentsController {
  async initiate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orderId, paymentKey } = req.body as InitiatePaymentBody;
      const { payment, isNew } = await paymentsService.initiate(
        requireUserId(req),
        orderId,
        paymentKey,
      );
      res.status(isNew ? 201 : 200).json({ payment });
    } catch (error) {
      next(error);
    }
  }

  async process(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payment = await paymentsService.process(requireUserId(req), req.params.paymentId);
      res.status(200).json({ payment });
    } catch (error) {
      next(error);
    }
  }

  async refund(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payment = await paymentsService.refund(req.params.paymentId);
      res.status(200).json({ payment });
    } catch (error) {
      next(error);
    }
  }
}

export const paymentsController = new PaymentsController();
