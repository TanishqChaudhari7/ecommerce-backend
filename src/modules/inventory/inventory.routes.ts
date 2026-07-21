import { Router } from 'express';
import { inventoryController } from './inventory.controller';
import { authenticateToken } from '../../middleware/authenticateToken';
import { requireRole } from '../../middleware/requireRole';
import { validateBody, validateParams } from '../../middleware/validate';
import { productIdParamSchema, updateInventorySchema } from './inventory.validation';

const router = Router();

/**
 * @openapi
 * /api/v1/inventory/low-stock:
 *   get:
 *     summary: List products at or below their low-stock threshold (seller sees own products, admin sees all)
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Low-stock products
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a seller or admin
 */
router.get(
  '/low-stock',
  authenticateToken,
  requireRole('seller', 'admin'),
  inventoryController.lowStock.bind(inventoryController),
);

/**
 * @openapi
 * /api/v1/inventory/{productId}:
 *   put:
 *     summary: Update a product's total stock (seller must own the product; admin can update any)
 *     tags: [Inventory]
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
 *             required: [totalStock]
 *             properties:
 *               totalStock: { type: integer, minimum: 0 }
 *     responses:
 *       200:
 *         description: Updated inventory status; publishes inventory.updated if available stock drops to/below the low-stock threshold
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a seller/admin, or a seller who does not own this product
 *       404:
 *         description: Product or inventory record not found
 */
router.put(
  '/:productId',
  authenticateToken,
  requireRole('seller', 'admin'),
  validateParams(productIdParamSchema),
  validateBody(updateInventorySchema),
  inventoryController.updateStock.bind(inventoryController),
);

export default router;
