import { pool } from '../../config/db';
import { redis, deleteKeysByPattern } from '../../config/redis';
import { publishEvent, KAFKA_TOPICS } from '../../config/kafka';
import { AppError } from '../../utils/AppError';
import { PaymentStatus, PublicPayment } from './payments.types';

interface PaymentRow {
  id: string;
  order_id: string;
  user_id: string;
  amount: string;
  status: PaymentStatus;
  payment_key: string;
  created_at: Date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function toPublicPayment(row: PaymentRow): PublicPayment {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    amount: Number(row.amount),
    status: row.status,
    paymentKey: row.payment_key,
    createdAt: row.created_at.toISOString(),
  };
}

export class PaymentsService {
  async initiate(
    userId: string,
    orderId: string,
    paymentKey: string,
  ): Promise<{ payment: PublicPayment; isNew: boolean }> {
    const existingResult = await pool.query<PaymentRow>(
      'SELECT * FROM payments WHERE payment_key = $1',
      [paymentKey],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      if (existing.user_id !== userId) {
        throw new AppError(403, 'This payment key belongs to another user');
      }
      return { payment: toPublicPayment(existing), isNew: false };
    }

    const orderResult = await pool.query<{ user_id: string; total_amount: string }>(
      'SELECT user_id, total_amount FROM orders WHERE id = $1',
      [orderId],
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw new AppError(404, 'Order not found');
    }
    if (order.user_id !== userId) {
      throw new AppError(403, 'You do not own this order');
    }

    try {
      const insertResult = await pool.query<PaymentRow>(
        `INSERT INTO payments (order_id, user_id, amount, status, payment_key)
         VALUES ($1, $2, $3, 'pending', $4)
         RETURNING *`,
        [orderId, userId, order.total_amount, paymentKey],
      );
      return { payment: toPublicPayment(insertResult.rows[0]), isNew: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raceResult = await pool.query<PaymentRow>(
          'SELECT * FROM payments WHERE payment_key = $1',
          [paymentKey],
        );
        return { payment: toPublicPayment(raceResult.rows[0]), isNew: false };
      }
      throw error;
    }
  }

  async process(userId: string, paymentId: string): Promise<PublicPayment> {
    const paymentResult = await pool.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [
      paymentId,
    ]);
    const payment = paymentResult.rows[0];
    if (!payment) {
      throw new AppError(404, 'Payment not found');
    }
    if (payment.user_id !== userId) {
      throw new AppError(403, 'You do not own this payment');
    }
    if (payment.status !== 'pending') {
      throw new AppError(400, `Payment already ${payment.status}`);
    }

    const orderResult = await pool.query<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1',
      [payment.order_id],
    );
    if (orderResult.rows[0]?.status !== 'pending') {
      throw new AppError(400, 'Order is no longer awaiting payment');
    }

    const success = Math.random() > 0.1;

    if (!success) {
      await pool.query("UPDATE payments SET status = 'failed' WHERE id = $1", [paymentId]);
      throw new AppError(402, 'Payment failed');
    }

    const client = await pool.connect();
    let updatedPayment: PaymentRow;
    try {
      await client.query('BEGIN');
      const updateResult = await client.query<PaymentRow>(
        "UPDATE payments SET status = 'completed' WHERE id = $1 RETURNING *",
        [paymentId],
      );
      updatedPayment = updateResult.rows[0];
      await client.query(
        "UPDATE orders SET status = 'confirmed', updated_at = now() WHERE id = $1",
        [payment.order_id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await publishEvent(KAFKA_TOPICS.PAYMENT_COMPLETED, {
      paymentId,
      orderId: payment.order_id,
      userId,
      amount: Number(payment.amount),
    });

    return toPublicPayment(updatedPayment);
  }

  async refund(paymentId: string): Promise<PublicPayment> {
    const client = await pool.connect();
    let updatedPayment: PaymentRow;
    let affectedProductIds: string[] = [];

    try {
      await client.query('BEGIN');

      const paymentResult = await client.query<PaymentRow>(
        'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
        [paymentId],
      );
      const payment = paymentResult.rows[0];
      if (!payment) {
        throw new AppError(404, 'Payment not found');
      }
      if (payment.status !== 'completed') {
        throw new AppError(400, `Cannot refund a payment with status ${payment.status}`);
      }

      const itemsResult = await client.query<{ product_id: string; quantity: number }>(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
        [payment.order_id],
      );

      for (const item of itemsResult.rows) {
        await client.query(
          'UPDATE inventory SET reserved_stock = reserved_stock - $1 WHERE product_id = $2',
          [item.quantity, item.product_id],
        );
      }
      affectedProductIds = itemsResult.rows.map((item) => item.product_id);

      const updateResult = await client.query<PaymentRow>(
        "UPDATE payments SET status = 'refunded' WHERE id = $1 RETURNING *",
        [paymentId],
      );
      updatedPayment = updateResult.rows[0];

      await client.query(
        "UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1",
        [payment.order_id],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    for (const productId of affectedProductIds) {
      await redis.del(`product:${productId}`);
    }
    await deleteKeysByPattern('search:*');

    return toPublicPayment(updatedPayment);
  }
}

export const paymentsService = new PaymentsService();
