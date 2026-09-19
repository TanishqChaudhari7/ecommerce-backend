import { pool } from '../../config/db';
import { invalidateProductCaches } from '../../config/redis';
import { publishEvent, KAFKA_TOPICS } from '../../config/kafka';
import { AppError } from '../../utils/AppError';
import { isCheckViolation } from '../../utils/pgErrors';
import { UserRole } from '../auth/auth.types';
import { InventoryStatus, LowStockProduct } from './inventory.types';

export class InventoryService {
  async updateStock(
    productId: string,
    userId: string,
    role: UserRole,
    totalStock: number,
  ): Promise<InventoryStatus> {
    const productResult = await pool.query<{ seller_id: string }>(
      'SELECT seller_id FROM products WHERE id = $1 AND is_deleted = false',
      [productId],
    );
    const product = productResult.rows[0];
    if (!product) {
      throw new AppError(404, 'Product not found');
    }
    if (role === 'seller' && product.seller_id !== userId) {
      throw new AppError(403, 'You do not own this product');
    }

    let result;
    try {
      result = await pool.query<{
        total_stock: number;
        reserved_stock: number;
        low_stock_threshold: number;
      }>(
        `UPDATE inventory SET total_stock = $1 WHERE product_id = $2
         RETURNING total_stock, reserved_stock, low_stock_threshold`,
        [totalStock, productId],
      );
    } catch (error) {
      // CHECK (reserved_stock <= total_stock): open orders already hold more than this.
      if (isCheckViolation(error)) {
        throw new AppError(409, 'Total stock cannot be lower than stock reserved by open orders');
      }
      throw error;
    }
    const inventory = result.rows[0];
    if (!inventory) {
      throw new AppError(404, 'Inventory record not found');
    }

    const availableStock = inventory.total_stock - inventory.reserved_stock;

    await invalidateProductCaches([productId]);

    if (availableStock <= inventory.low_stock_threshold) {
      await publishEvent(KAFKA_TOPICS.INVENTORY_UPDATED, {
        productId,
        totalStock: inventory.total_stock,
        reservedStock: inventory.reserved_stock,
        availableStock,
        lowStockThreshold: inventory.low_stock_threshold,
      });
    }

    return {
      productId,
      totalStock: inventory.total_stock,
      reservedStock: inventory.reserved_stock,
      availableStock,
      lowStockThreshold: inventory.low_stock_threshold,
    };
  }

  async getLowStock(userId: string, role: UserRole): Promise<LowStockProduct[]> {
    const conditions = [
      'p.is_deleted = false',
      '(i.total_stock - i.reserved_stock) <= i.low_stock_threshold',
    ];
    const params: unknown[] = [];

    if (role === 'seller') {
      params.push(userId);
      conditions.push(`p.seller_id = $${params.length}`);
    }

    const result = await pool.query<{
      id: string;
      name: string;
      sku: string;
      total_stock: number;
      reserved_stock: number;
      low_stock_threshold: number;
      available_stock: number;
    }>(
      `SELECT p.id, p.name, p.sku, i.total_stock, i.reserved_stock, i.low_stock_threshold,
              (i.total_stock - i.reserved_stock) AS available_stock
       FROM products p
       JOIN inventory i ON i.product_id = p.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY available_stock ASC`,
      params,
    );

    return result.rows.map((row) => ({
      productId: row.id,
      name: row.name,
      sku: row.sku,
      totalStock: row.total_stock,
      reservedStock: row.reserved_stock,
      lowStockThreshold: row.low_stock_threshold,
      availableStock: row.available_stock,
    }));
  }
}

export const inventoryService = new InventoryService();
