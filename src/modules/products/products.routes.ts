import { Router } from 'express';
import { productsController } from './products.controller';
import { authenticateToken } from '../../middleware/authenticateToken';
import { requireRole } from '../../middleware/requireRole';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import {
  listProductsQuerySchema,
  productIdParamSchema,
  createProductSchema,
  updateProductSchema,
} from './products.validation';

const router = Router();

/**
 * @openapi
 * /api/v1/products:
 *   get:
 *     summary: List products (paginated)
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: A page of products with category, seller, and available stock info
 */
router.get(
  '/',
  validateQuery(listProductsQuerySchema),
  productsController.list.bind(productsController),
);

/**
 * @openapi
 * /api/v1/products/{id}:
 *   get:
 *     summary: Get a single product by id (cached in Redis for 10 minutes)
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The product
 *       422:
 *         description: Invalid id
 *       404:
 *         description: Product not found
 */
router.get(
  '/:id',
  validateParams(productIdParamSchema),
  productsController.getById.bind(productsController),
);

/**
 * @openapi
 * /api/v1/products:
 *   post:
 *     summary: Create a product (seller only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price, sku]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               price: { type: number }
 *               sku: { type: string }
 *               brand: { type: string }
 *               categoryId: { type: string, format: uuid }
 *               isAvailable: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Product created; an inventory record with 0 stock is created alongside it
 *       422:
 *         description: Validation failed
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller is not a seller
 *       409:
 *         description: SKU already exists
 */
router.post(
  '/',
  authenticateToken,
  requireRole('seller'),
  validateBody(createProductSchema),
  productsController.create.bind(productsController),
);

/**
 * @openapi
 * /api/v1/products/{id}:
 *   put:
 *     summary: Update a product (seller only, must own the product)
 *     tags: [Products]
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
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               price: { type: number }
 *               brand: { type: string }
 *               categoryId: { type: string, format: uuid, nullable: true }
 *               isAvailable: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated product; invalidates product and search caches and publishes product.updated
 *       422:
 *         description: Validation failed
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller does not own this product
 *       404:
 *         description: Product not found
 */
router.put(
  '/:id',
  authenticateToken,
  requireRole('seller'),
  validateParams(productIdParamSchema),
  validateBody(updateProductSchema),
  productsController.update.bind(productsController),
);

/**
 * @openapi
 * /api/v1/products/{id}:
 *   delete:
 *     summary: Soft-delete a product (seller only, must own the product)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Product marked as deleted
 *       401:
 *         description: Missing or invalid access token
 *       403:
 *         description: Caller does not own this product
 *       404:
 *         description: Product not found
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole('seller'),
  validateParams(productIdParamSchema),
  productsController.remove.bind(productsController),
);

export default router;
