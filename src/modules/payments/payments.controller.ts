import { Request, Response, NextFunction } from 'express';
import { paymentsService } from './payments.service';
import { requireUser } from '../../utils/requireUser';
import { InitiatePaymentBody } from './payments.validation';

export class PaymentsController {
  async initiate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orderId, paymentKey } = req.body as InitiatePaymentBody;
      const { payment, isNew } = await paymentsService.initiate(
        requireUser(req).userId,
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
      const payment = await paymentsService.process(requireUser(req).userId, req.params.paymentId);
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
