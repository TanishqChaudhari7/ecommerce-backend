import { Router } from 'express';
import { ordersController } from './orders.controller';
import { authenticateToken } from '../../middleware/authenticateToken';
import { requireRole } from '../../middleware/requireRole';
import { validateBody, validateParams } from '../../middleware/validate';
import { orderIdParamSchema, updateOrderStatusSchema } from './orders.validation';

const router = Router();

router.use(authenticateToken);

/**
 * @openapi
 * /api/v1/orders:
 *   post:
 *     summary: Place an order from the current cart (customer only)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Order placed; reserves stock, clears the cart, publishes order.created
 *       400:
 *         description: Cart is empty, or a cart item is unavailable / exceeds available stock
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a customer
 */
router.post('/', requireRole('customer'), ordersController.placeOrder.bind(ordersController));

/**
 * @openapi
 * /api/v1/orders:
 *   get:
 *     summary: List orders (customer sees own orders, admin sees all)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Orders list
 *       401:
 *         description: Missing or invalid access token
 */
router.get('/', ordersController.listOrders.bind(ordersController));

/**
 * @openapi
 * /api/v1/orders/{id}:
 *   get:
 *     summary: Get a single order, including items and latest payment status
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The order
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller does not own this order
 *       404:
 *         description: Order not found
 */
router.get(
  '/:id',
  validateParams(orderIdParamSchema),
  ordersController.getOrderById.bind(ordersController),
);

/**
 * @openapi
 * /api/v1/orders/{id}/cancel:
 *   put:
 *     summary: Cancel an order (customer only; only while pending or confirmed)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Order cancelled; releases reserved stock, publishes order.cancelled
 *       400:
 *         description: Order is not in a cancellable status
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller does not own this order
 *       404:
 *         description: Order not found
 */
router.put(
  '/:id/cancel',
  requireRole('customer'),
  validateParams(orderIdParamSchema),
  ordersController.cancelOrder.bind(ordersController),
);

/**
 * @openapi
 * /api/v1/orders/{id}/status:
 *   put:
 *     summary: Advance an order's status (admin only)
 *     description: Valid transitions are pending→confirmed, confirmed→shipped, shipped→delivered. Delivering an order permanently deducts total_stock and releases reserved_stock.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [confirmed, shipped, delivered] }
 *     responses:
 *       200:
 *         description: Updated order
 *       400:
 *         description: Invalid status transition
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: Order not found
 */
router.put(
  '/:id/status',
  requireRole('admin'),
  validateParams(orderIdParamSchema),
  validateBody(updateOrderStatusSchema),
  ordersController.updateStatus.bind(ordersController),
);

export default router;
