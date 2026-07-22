import request from 'supertest';
import { app } from '../../src/app';
import { pool } from '../../src/config/db';
import { getSellerToken, getCustomerToken, getAdminToken } from '../helpers/auth';

function freshSku(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createProductWithStock(sellerToken: string, stock: number): Promise<string> {
  const createResponse = await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ name: 'Order Test Product', price: 10, sku: freshSku('ORDER-TEST') });
  const productId = createResponse.body.product.id;

  await request(app)
    .put(`/api/v1/inventory/${productId}`)
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ totalStock: stock });

  return productId;
}

async function getReservedStock(productId: string): Promise<number> {
  const result = await pool.query<{ reserved_stock: number }>(
    'SELECT reserved_stock FROM inventory WHERE product_id = $1',
    [productId],
  );
  return result.rows[0].reserved_stock;
}

describe('Orders API', () => {
  it('places an order: cart cleared, reserved_stock incremented, status pending', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 2 });

    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(201);
    expect(response.body.order.status).toBe('pending');

    const cart = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${customerToken}`);
    const stillInCart = cart.body.cart.items.find(
      (item: { productId: string }) => item.productId === productId,
    );
    expect(stillInCart).toBeUndefined();

    expect(await getReservedStock(productId)).toBe(2);
  });

  it('returns 400 when placing an order with an empty cart', async () => {
    const customerToken = await getCustomerToken();
    await request(app).delete('/api/v1/cart').set('Authorization', `Bearer ${customerToken}`);

    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(400);
  });

  it('returns 400 when placing an order with insufficient stock', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 5);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 3 });

    // Stock drops below what's already in the cart before the order is placed.
    await request(app)
      .put(`/api/v1/inventory/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ totalStock: 1 });

    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(400);

    await request(app).delete('/api/v1/cart').set('Authorization', `Bearer ${customerToken}`);
  });

  it('cancels an order: reserved_stock released, status cancelled', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 3 });

    const order = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`);
    const orderId = order.body.order.id;

    const response = await request(app)
      .put(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe('cancelled');
    expect(await getReservedStock(productId)).toBe(0);
  });

  it('lets an admin move an order through the full status lifecycle', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const adminToken = await getAdminToken();
    const productId = await createProductWithStock(sellerToken, 10);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 1 });

    const order = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`);
    const orderId = order.body.order.id;

    const confirmed = await request(app)
      .put(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'confirmed' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.order.status).toBe('confirmed');

    const shipped = await request(app)
      .put(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'shipped' });
    expect(shipped.status).toBe(200);
    expect(shipped.body.order.status).toBe('shipped');

    const delivered = await request(app)
      .put(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'delivered' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.order.status).toBe('delivered');
  });

  it('cannot cancel a delivered order', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const adminToken = await getAdminToken();
    const productId = await createProductWithStock(sellerToken, 10);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 1 });

    const order = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`);
    const orderId = order.body.order.id;

    await request(app)
      .put(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'confirmed' });
    await request(app)
      .put(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'shipped' });
    await request(app)
      .put(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'delivered' });

    const response = await request(app)
      .put(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(400);
  });
});
