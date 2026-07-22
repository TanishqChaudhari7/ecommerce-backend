import { Router } from 'express';
import { searchController } from './search.controller';
import { validateQuery } from '../../middleware/validate';
import { searchQuerySchema } from './search.validation';

const router = Router();

/**
 * @openapi
 * /api/v1/search:
 *   get:
 *     summary: Full-text search products with filters, sorting, and pagination
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Keyword search against name, brand, and description (PostgreSQL plainto_tsquery)
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Category slug
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: brand
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [price, created_at], default: created_at }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Matching products (response is cached in Redis for 5 minutes per unique query)
 *       422:
 *         description: Validation failed
 */
router.get('/', validateQuery(searchQuerySchema), searchController.search.bind(searchController));

export default router;
