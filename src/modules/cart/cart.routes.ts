import { Router } from 'express';
import { cartController } from './cart.controller';
import { authenticateToken } from '../../middleware/authenticateToken';
import { requireRole } from '../../middleware/requireRole';
import { validateBody, validateParams } from '../../middleware/validate';
import { addCartItemSchema, updateCartItemSchema, cartItemParamSchema } from './cart.validation';

const router = Router();

router.use(authenticateToken, requireRole('customer'));

/**
 * @openapi
 * /api/v1/cart:
 *   get:
 *     summary: Get the current customer's cart, with product details and calculated total
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The cart
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a customer
 */
router.get('/', cartController.getCart.bind(cartController));

/**
 * @openapi
 * /api/v1/cart:
 *   delete:
 *     summary: Clear all items from the current customer's cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Cart cleared
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a customer
 */
router.delete('/', cartController.clearCart.bind(cartController));

/**
 * @openapi
 * /api/v1/cart/items:
 *   post:
 *     summary: Add a product to the cart (increments quantity if already present)
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, quantity]
 *             properties:
 *               productId: { type: string, format: uuid }
 *               quantity: { type: integer, minimum: 1 }
 *     responses:
 *       201:
 *         description: Updated cart
 *       400:
 *         description: Validation failed, product unavailable, or quantity exceeds available stock
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a customer
 *       404:
 *         description: Product not found
 */
router.post('/items', validateBody(addCartItemSchema), cartController.addItem.bind(cartController));

/**
 * @openapi
 * /api/v1/cart/items/{productId}:
 *   put:
 *     summary: Set the quantity of a product already in the cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Updated cart
 *       400:
 *         description: Validation failed, product unavailable, or quantity exceeds available stock
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a customer
 *       404:
 *         description: Product not found, or not in the cart
 */
router.put(
  '/items/:productId',
  validateParams(cartItemParamSchema),
  validateBody(updateCartItemSchema),
  cartController.updateItem.bind(cartController),
);

/**
 * @openapi
 * /api/v1/cart/items/{productId}:
 *   delete:
 *     summary: Remove a product from the cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated cart
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a customer
 */
router.delete(
  '/items/:productId',
  validateParams(cartItemParamSchema),
  cartController.removeItem.bind(cartController),
);

export default router;
