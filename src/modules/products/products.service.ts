import { pool } from '../../config/db';
import { redis, deleteKeysByPattern } from '../../config/redis';
import { publishEvent, KAFKA_TOPICS } from '../../config/kafka';
import { AppError } from '../../utils/AppError';
import {
  CreateProductInput,
  Pagination,
  ProductRow,
  PublicProduct,
  UpdateProductInput,
} from './products.types';
import { PRODUCT_SELECT, toPublicProduct } from './products.query';

const PRODUCT_CACHE_TTL_SECONDS = 600;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

async function findOwnableProduct(
  id: string,
): Promise<{ id: string; sellerId: string } | undefined> {
  const result = await pool.query<{ id: string; seller_id: string }>(
    'SELECT id, seller_id FROM products WHERE id = $1 AND is_deleted = false',
    [id],
  );
  const row = result.rows[0];
  return row ? { id: row.id, sellerId: row.seller_id } : undefined;
}

async function fetchPublicProduct(id: string): Promise<PublicProduct> {
  const result = await pool.query<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'Product not found');
  }
  return toPublicProduct(row);
}

export class ProductsService {
  async listProducts(
    page: number,
    limit: number,
  ): Promise<{ products: PublicProduct[]; pagination: Pagination }> {
    const offset = (page - 1) * limit;

    const countResult = await pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM products WHERE is_deleted = false',
    );
    const total = Number(countResult.rows[0].count);

    const result = await pool.query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.is_deleted = false ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return {
      products: result.rows.map(toPublicProduct),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProductById(id: string): Promise<PublicProduct> {
    const cacheKey = `product:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PublicProduct;
    }

    const result = await pool.query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.id = $1 AND p.is_deleted = false`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(404, 'Product not found');
    }

    const product = toPublicProduct(row);
    await redis.set(cacheKey, JSON.stringify(product), 'EX', PRODUCT_CACHE_TTL_SECONDS);
    return product;
  }

  async createProduct(sellerId: string, input: CreateProductInput): Promise<PublicProduct> {
    const client = await pool.connect();
    let productId: string;

    try {
      await client.query('BEGIN');

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO products (seller_id, category_id, name, description, price, sku, brand, is_available)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          sellerId,
          input.categoryId ?? null,
          input.name,
          input.description ?? null,
          input.price,
          input.sku,
          input.brand ?? null,
          input.isAvailable,
        ],
      );
      productId = insertResult.rows[0].id;

      await client.query('INSERT INTO inventory (product_id) VALUES ($1)', [productId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'SKU already exists');
      }
      throw error;
    } finally {
      client.release();
    }

    await deleteKeysByPattern('search:*');

    return fetchPublicProduct(productId);
  }

  async updateProduct(
    id: string,
    sellerId: string,
    input: UpdateProductInput,
  ): Promise<PublicProduct> {
    const existing = await findOwnableProduct(id);
    if (!existing) {
      throw new AppError(404, 'Product not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new AppError(403, 'You do not own this product');
    }

    const fieldMap: Record<string, unknown> = {
      name: input.name,
      description: input.description,
      price: input.price,
      brand: input.brand,
      category_id: input.categoryId,
      is_available: input.isAvailable,
    };

    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const [column, value] of Object.entries(fieldMap)) {
      if (value !== undefined) {
        params.push(value);
        setClauses.push(`${column} = $${params.length}`);
      }
    }

    setClauses.push('updated_at = now()');
    params.push(id);

    await pool.query(
      `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
      params,
    );

    await redis.del(`product:${id}`);
    await deleteKeysByPattern('search:*');
    await publishEvent(KAFKA_TOPICS.PRODUCT_UPDATED, {
      productId: id,
      sellerId,
      updatedAt: new Date().toISOString(),
    });

    return fetchPublicProduct(id);
  }

  async deleteProduct(id: string, sellerId: string): Promise<void> {
    const existing = await findOwnableProduct(id);
    if (!existing) {
      throw new AppError(404, 'Product not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new AppError(403, 'You do not own this product');
    }

    await pool.query('UPDATE products SET is_deleted = true, updated_at = now() WHERE id = $1', [
      id,
    ]);

    await redis.del(`product:${id}`);
    await deleteKeysByPattern('search:*');
  }
}

export const productsService = new ProductsService();
