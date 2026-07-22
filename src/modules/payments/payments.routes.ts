import { Router } from 'express';
import { paymentsController } from './payments.controller';
import { authenticateToken } from '../../middleware/authenticateToken';
import { requireRole } from '../../middleware/requireRole';
import { validateBody, validateParams } from '../../middleware/validate';
import { initiatePaymentSchema, paymentIdParamSchema } from './payments.validation';

const router = Router();

router.use(authenticateToken);

/**
 * @openapi
 * /api/v1/payments/initiate:
 *   post:
 *     summary: Initiate a payment for an order (customer only, idempotent by paymentKey)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, paymentKey]
 *             properties:
 *               orderId: { type: string, format: uuid }
 *               paymentKey: { type: string }
 *     responses:
 *       200:
 *         description: A payment already existed for this paymentKey; it is returned as-is
 *       201:
 *         description: A new pending payment record was created
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller does not own the order, or the paymentKey belongs to another user
 *       404:
 *         description: Order not found
 */
router.post(
  '/initiate',
  requireRole('customer'),
  validateBody(initiatePaymentSchema),
  paymentsController.initiate.bind(paymentsController),
);

/**
 * @openapi
 * /api/v1/payments/process/{paymentId}:
 *   post:
 *     summary: Process a pending payment (customer only; mocked 90% success rate)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment completed; order confirmed; publishes payment.completed
 *       400:
 *         description: Payment is not pending, or the order is no longer awaiting payment
 *       401:
 *         description: Missing or invalid access token
 *       402:
 *         description: Payment failed (mocked failure)
 *       403:
 *         description: Caller does not own this payment
 *       404:
 *         description: Payment not found
 */
router.post(
  '/process/:paymentId',
  requireRole('customer'),
  validateParams(paymentIdParamSchema),
  paymentsController.process.bind(paymentsController),
);

/**
 * @openapi
 * /api/v1/payments/refund/{paymentId}:
 *   post:
 *     summary: Refund a completed payment (admin only)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment refunded; order cancelled; reserved stock released for each order item
 *       400:
 *         description: Payment is not in a refundable status
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: Payment not found
 */
router.post(
  '/refund/:paymentId',
  requireRole('admin'),
  validateParams(paymentIdParamSchema),
  paymentsController.refund.bind(paymentsController),
);

export default router;
