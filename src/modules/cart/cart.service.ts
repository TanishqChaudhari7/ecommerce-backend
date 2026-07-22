import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { CartDetail, CartItemDetail } from './cart.types';

interface ProductStock {
  price: number;
  isAvailable: boolean;
  availableStock: number;
}

async function getProductStock(productId: string): Promise<ProductStock | undefined> {
  const result = await pool.query<{
    price: string;
    is_available: boolean;
    available_stock: number;
  }>(
    `SELECT p.price, p.is_available,
            (COALESCE(i.total_stock, 0) - COALESCE(i.reserved_stock, 0)) AS available_stock
     FROM products p
     LEFT JOIN inventory i ON i.product_id = p.id
     WHERE p.id = $1 AND p.is_deleted = false`,
    [productId],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  return {
    price: Number(row.price),
    isAvailable: row.is_available,
    availableStock: row.available_stock,
  };
}

async function findOrCreateCart(userId: string): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM shopping_carts WHERE user_id = $1',
    [userId],
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO shopping_carts (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING id`,
    [userId],
  );
  if (inserted.rows[0]) {
    return inserted.rows[0].id;
  }

  const raceResult = await pool.query<{ id: string }>(
    'SELECT id FROM shopping_carts WHERE user_id = $1',
    [userId],
  );
  return raceResult.rows[0].id;
}

async function buildCartDetail(cartId: string): Promise<CartDetail> {
  const result = await pool.query<{
    product_id: string;
    name: string;
    price: string;
    quantity: number;
    available_stock: number;
  }>(
    `SELECT ci.product_id, p.name, p.price, ci.quantity,
            (COALESCE(i.total_stock, 0) - COALESCE(i.reserved_stock, 0)) AS available_stock
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN inventory i ON i.product_id = p.id
     WHERE ci.cart_id = $1
     ORDER BY p.name ASC`,
    [cartId],
  );

  const items: CartItemDetail[] = result.rows.map((row) => ({
    productId: row.product_id,
    productName: row.name,
    price: Number(row.price),
    quantity: row.quantity,
    subtotal: Number(row.price) * row.quantity,
    availableStock: row.available_stock,
  }));

  return {
    id: cartId,
    items,
    total: items.reduce((sum, item) => sum + item.subtotal, 0),
  };
}

export class CartService {
  async getCart(userId: string): Promise<CartDetail> {
    const cartId = await findOrCreateCart(userId);
    return buildCartDetail(cartId);
  }

  async addItem(userId: string, productId: string, quantity: number): Promise<CartDetail> {
    const product = await getProductStock(productId);
    if (!product) {
      throw new AppError(404, 'Product not found');
    }
    if (!product.isAvailable) {
      throw new AppError(400, 'Product is not available');
    }

    const cartId = await findOrCreateCart(userId);

    const existing = await pool.query<{ quantity: number }>(
      'SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
      [cartId, productId],
    );
    const newQuantity = (existing.rows[0]?.quantity ?? 0) + quantity;

    if (newQuantity > product.availableStock) {
      throw new AppError(400, 'Requested quantity exceeds available stock');
    }

    await pool.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = $3`,
      [cartId, productId, newQuantity],
    );

    return buildCartDetail(cartId);
  }

  async updateItem(userId: string, productId: string, quantity: number): Promise<CartDetail> {
    const product = await getProductStock(productId);
    if (!product) {
      throw new AppError(404, 'Product not found');
    }
    if (!product.isAvailable) {
      throw new AppError(400, 'Product is not available');
    }
    if (quantity > product.availableStock) {
      throw new AppError(400, 'Requested quantity exceeds available stock');
    }

    const cartId = await findOrCreateCart(userId);

    const result = await pool.query(
      'UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND product_id = $3',
      [quantity, cartId, productId],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'Item not in cart');
    }

    return buildCartDetail(cartId);
  }

  async removeItem(userId: string, productId: string): Promise<CartDetail> {
    const cartId = await findOrCreateCart(userId);
    await pool.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [
      cartId,
      productId,
    ]);
    return buildCartDetail(cartId);
  }

  async clearCart(userId: string): Promise<void> {
    const cartId = await findOrCreateCart(userId);
    await pool.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
  }
}

export const cartService = new CartService();
