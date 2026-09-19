import { pool } from '../../config/db';
import { redis, deleteKeysByPattern } from '../../config/redis';
import { publishEvent, KAFKA_TOPICS } from '../../config/kafka';
import { AppError } from '../../utils/AppError';
import { UserRole } from '../auth/auth.types';
import { adjustOrderStock } from '../inventory/inventory.stock';
import { OrderDetail, OrderItemDetail, OrderSummary, OrderStatus } from './orders.types';

const ALLOWED_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'confirmed',
  confirmed: 'shipped',
  shipped: 'delivered',
};

const STOCK_RELEASE_TTL_SECONDS = 60 * 60 * 24 * 7;

async function invalidateProductCaches(productIds: string[]): Promise<void> {
  if (productIds.length > 0) {
    await redis.del(...productIds.map((productId) => `product:${productId}`));
  }
  await deleteKeysByPattern('search:*');
}

async function fetchOrderItems(orderId: string): Promise<OrderItemDetail[]> {
  const result = await pool.query<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: string;
  }>(
    `SELECT oi.product_id, p.name, oi.quantity, oi.unit_price
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`,
    [orderId],
  );
  return result.rows.map((row) => ({
    productId: row.product_id,
    productName: row.name,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
  }));
}

async function fetchOrderDetail(orderId: string): Promise<OrderDetail> {
  // The three reads are independent, so issue them together rather than paying three
  // sequential round trips on the checkout response path.
  const [orderResult, items, paymentResult] = await Promise.all([
    pool.query<{
      id: string;
      status: OrderStatus;
      total_amount: string;
      created_at: Date;
      updated_at: Date;
    }>('SELECT id, status, total_amount, created_at, updated_at FROM orders WHERE id = $1', [
      orderId,
    ]),
    fetchOrderItems(orderId),
    pool.query<{ status: string }>(
      'SELECT status FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
      [orderId],
    ),
  ]);

  const order = orderResult.rows[0];
  if (!order) {
    throw new AppError(404, 'Order not found');
  }

  return {
    id: order.id,
    status: order.status,
    totalAmount: Number(order.total_amount),
    createdAt: order.created_at.toISOString(),
    updatedAt: order.updated_at.toISOString(),
    items,
    paymentStatus: paymentResult.rows[0]?.status ?? null,
  };
}

export class OrdersService {
  async placeOrder(userId: string): Promise<OrderDetail> {
    const client = await pool.connect();
    let orderId: string;
    let items: { product_id: string; quantity: number; price: string }[];

    try {
      await client.query('BEGIN');

      // Locking the cart serializes checkouts by the same customer: a double-submitted
      // second request waits here, then (in a fresh statement snapshot) finds the cart
      // the first request already emptied, instead of ordering the same items twice.
      const cartResult = await client.query<{ id: string }>(
        'SELECT id FROM shopping_carts WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      const cartId = cartResult.rows[0]?.id;
      if (!cartId) {
        throw new AppError(400, 'Cart is empty');
      }

      const itemsResult = await client.query<{
        product_id: string;
        quantity: number;
        price: string;
        is_available: boolean;
        is_deleted: boolean;
        available_stock: number;
      }>(
        `SELECT ci.product_id, ci.quantity, p.price, p.is_available, p.is_deleted,
                (i.total_stock - i.reserved_stock) AS available_stock
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN inventory i ON i.product_id = p.id
         WHERE ci.cart_id = $1
         ORDER BY ci.product_id
         FOR UPDATE OF i`,
        [cartId],
      );

      if (itemsResult.rows.length === 0) {
        throw new AppError(400, 'Cart is empty');
      }

      for (const item of itemsResult.rows) {
        if (item.is_deleted || !item.is_available) {
          throw new AppError(400, `Product ${item.product_id} is not available`);
        }
        if (item.quantity > item.available_stock) {
          throw new AppError(400, `Insufficient stock for product ${item.product_id}`);
        }
      }

      await client.query(
        `UPDATE inventory i
         SET reserved_stock = i.reserved_stock + u.quantity
         FROM unnest($1::uuid[], $2::int[]) AS u(product_id, quantity)
         WHERE i.product_id = u.product_id`,
        [
          itemsResult.rows.map((item) => item.product_id),
          itemsResult.rows.map((item) => item.quantity),
        ],
      );

      const totalAmount = itemsResult.rows.reduce(
        (sum, item) => sum + item.quantity * Number(item.price),
        0,
      );

      const orderResult = await client.query<{ id: string }>(
        `INSERT INTO orders (user_id, status, total_amount)
         VALUES ($1, 'pending', $2)
         RETURNING id`,
        [userId, totalAmount],
      );
      orderId = orderResult.rows[0].id;

      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         SELECT $1, u.product_id, u.quantity, u.unit_price
         FROM unnest($2::uuid[], $3::int[], $4::numeric[]) AS u(product_id, quantity, unit_price)`,
        [
          orderId,
          itemsResult.rows.map((item) => item.product_id),
          itemsResult.rows.map((item) => item.quantity),
          itemsResult.rows.map((item) => item.price),
        ],
      );

      await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

      await client.query('COMMIT');
      items = itemsResult.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await invalidateProductCaches(items.map((item) => item.product_id));

    await publishEvent(KAFKA_TOPICS.ORDER_CREATED, {
      orderId,
      userId,
      items: items.map((item) => ({
        productId: item.product_id,
        quantity: item.quantity,
        unitPrice: Number(item.price),
      })),
      totalAmount: items.reduce((sum, item) => sum + item.quantity * Number(item.price), 0),
    });

    return fetchOrderDetail(orderId);
  }

  async listOrders(userId: string, role: UserRole): Promise<OrderSummary[]> {
    const result = await pool.query<{
      id: string;
      status: OrderStatus;
      total_amount: string;
      created_at: Date;
      updated_at: Date;
    }>(
      role === 'admin'
        ? 'SELECT id, status, total_amount, created_at, updated_at FROM orders ORDER BY created_at DESC'
        : 'SELECT id, status, total_amount, created_at, updated_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      role === 'admin' ? [] : [userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      totalAmount: Number(row.total_amount),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async getOrderById(orderId: string, userId: string, role: UserRole): Promise<OrderDetail> {
    const ownerResult = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM orders WHERE id = $1',
      [orderId],
    );
    const owner = ownerResult.rows[0];
    if (!owner) {
      throw new AppError(404, 'Order not found');
    }
    if (role !== 'admin' && owner.user_id !== userId) {
      throw new AppError(403, 'You do not own this order');
    }

    return fetchOrderDetail(orderId);
  }

  async cancelOrder(orderId: string, userId: string): Promise<OrderDetail> {
    const client = await pool.connect();
    let items: { product_id: string; quantity: number }[];

    try {
      await client.query('BEGIN');

      const orderResult = await client.query<{ user_id: string; status: OrderStatus }>(
        'SELECT user_id, status FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const order = orderResult.rows[0];
      if (!order) {
        throw new AppError(404, 'Order not found');
      }
      if (order.user_id !== userId) {
        throw new AppError(403, 'You do not own this order');
      }
      if (order.status !== 'pending' && order.status !== 'confirmed') {
        throw new AppError(400, `Cannot cancel an order with status ${order.status}`);
      }

      const itemsResult = await client.query<{ product_id: string; quantity: number }>(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
        [orderId],
      );
      items = itemsResult.rows;

      await adjustOrderStock(client, orderId, 'release');

      await client.query(
        "UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1",
        [orderId],
      );

      // A confirmed order has been paid for; cancelling it must give the money back too.
      await client.query(
        "UPDATE payments SET status = 'refunded' WHERE order_id = $1 AND status = 'completed'",
        [orderId],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Claim the release marker so the async InventoryConsumer (reacting to the event
    // published below) sees the reservation was already released synchronously here
    // and skips re-decrementing.
    await redis.set(`order:stock-released:${orderId}`, '1', 'EX', STOCK_RELEASE_TTL_SECONDS, 'NX');

    await invalidateProductCaches(items.map((item) => item.product_id));

    await publishEvent(KAFKA_TOPICS.ORDER_CANCELLED, {
      orderId,
      userId,
      items: items.map((item) => ({ productId: item.product_id, quantity: item.quantity })),
    });

    return fetchOrderDetail(orderId);
  }

  async updateStatus(orderId: string, targetStatus: OrderStatus): Promise<OrderDetail> {
    const client = await pool.connect();
    let affectedProductIds: string[] = [];

    try {
      await client.query('BEGIN');

      const orderResult = await client.query<{ status: OrderStatus }>(
        'SELECT status FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const order = orderResult.rows[0];
      if (!order) {
        throw new AppError(404, 'Order not found');
      }

      const expectedNext = ALLOWED_TRANSITIONS[order.status];
      if (expectedNext !== targetStatus) {
        throw new AppError(400, `Cannot transition order from ${order.status} to ${targetStatus}`);
      }

      await client.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [
        targetStatus,
        orderId,
      ]);

      if (targetStatus === 'delivered') {
        affectedProductIds = await adjustOrderStock(client, orderId, 'consume');
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (affectedProductIds.length > 0) {
      await invalidateProductCaches(affectedProductIds);
    }

    return fetchOrderDetail(orderId);
  }
}

export const ordersService = new OrdersService();
