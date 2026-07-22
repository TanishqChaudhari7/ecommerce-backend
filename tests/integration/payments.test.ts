import request from 'supertest';
import { app } from '../../src/app';
import { pool } from '../../src/config/db';
import { getSellerToken, getCustomerToken, getAdminToken } from '../helpers/auth';

const MAX_PROCESS_ATTEMPTS = 40;

function freshSku(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createProductWithStock(sellerToken: string, stock: number): Promise<string> {
  const createResponse = await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ name: 'Payment Test Product', price: 10, sku: freshSku('PAY-TEST') });
  const productId = createResponse.body.product.id;

  await request(app)
    .put(`/api/v1/inventory/${productId}`)
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ totalStock: stock });

  return productId;
}

async function placeFreshOrder(
  sellerToken: string,
  customerToken: string,
): Promise<{ orderId: string; productId: string }> {
  const productId = await createProductWithStock(sellerToken, 10);

  await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ productId, quantity: 1 });

  const order = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${customerToken}`);

  return { orderId: order.body.order.id, productId };
}

/** Retries payment processing (mocked ~90% success) against the same pending order until it succeeds. */
async function processUntilSuccess(
  customerToken: string,
  orderId: string,
): Promise<{ paymentId: string }> {
  for (let attempt = 0; attempt < MAX_PROCESS_ATTEMPTS; attempt += 1) {
    const initiate = await request(app)
      .post('/api/v1/payments/initiate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId, paymentKey: `PAY-RETRY-${orderId}-${attempt}` });
    const paymentId = initiate.body.payment.id;

    const processed = await request(app)
      .post(`/api/v1/payments/process/${paymentId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    if (processed.status === 200) {
      return { paymentId };
    }
  }
  throw new Error(`Payment did not succeed within ${MAX_PROCESS_ATTEMPTS} attempts`);
}

describe('Payments API', () => {
  it('initiate creates a payment record', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const { orderId } = await placeFreshOrder(sellerToken, customerToken);

    const response = await request(app)
      .post('/api/v1/payments/initiate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId, paymentKey: `PAY-CREATE-${orderId}` });

    expect(response.status).toBe(201);
    expect(response.body.payment.status).toBe('pending');
  });

  it('returns the existing record for the same payment_key', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const { orderId } = await placeFreshOrder(sellerToken, customerToken);
    const paymentKey = `PAY-DUP-${orderId}`;

    const first = await request(app)
      .post('/api/v1/payments/initiate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId, paymentKey });
    const second = await request(app)
      .post('/api/v1/payments/initiate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId, paymentKey });

    expect(second.status).toBe(200);
    expect(second.body.payment.id).toBe(first.body.payment.id);
  });

  it('processing to success completes the payment and confirms the order', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const { orderId } = await placeFreshOrder(sellerToken, customerToken);

    await processUntilSuccess(customerToken, orderId);

    const orderResponse = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(orderResponse.body.order.status).toBe('confirmed');
  });

  it('refund releases reserved_stock and cancels the order', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const adminToken = await getAdminToken();
    const { orderId, productId } = await placeFreshOrder(sellerToken, customerToken);

    const { paymentId } = await processUntilSuccess(customerToken, orderId);

    const refundResponse = await request(app)
      .post(`/api/v1/payments/refund/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(refundResponse.status).toBe(200);
    expect(refundResponse.body.payment.status).toBe('refunded');

    const orderResponse = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(orderResponse.body.order.status).toBe('cancelled');

    const inventoryResult = await pool.query<{ reserved_stock: number }>(
      'SELECT reserved_stock FROM inventory WHERE product_id = $1',
      [productId],
    );
    expect(inventoryResult.rows[0].reserved_stock).toBe(0);
  });
});
