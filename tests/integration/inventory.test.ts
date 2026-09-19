import request from 'supertest';
import { app } from '../../src/app';
import { getSellerToken, getCustomerToken, createDisposableCustomerToken } from '../helpers/auth';

async function createProductWithStock(sellerToken: string, stock: number): Promise<string> {
  const createResponse = await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({
      name: 'Inventory Test Product',
      price: 10,
      sku: `INV-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  const productId = createResponse.body.product.id;

  await request(app)
    .put(`/api/v1/inventory/${productId}`)
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ totalStock: stock });

  return productId;
}

describe('Inventory API', () => {
  it('updates total stock and reports available stock', async () => {
    const sellerToken = await getSellerToken();
    const productId = await createProductWithStock(sellerToken, 25);

    const response = await request(app)
      .put(`/api/v1/inventory/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ totalStock: 40 });

    expect(response.status).toBe(200);
    expect(response.body.inventory).toMatchObject({
      totalStock: 40,
      reservedStock: 0,
      availableStock: 40,
    });
  });

  it('returns 409 when total stock would drop below reserved stock', async () => {
    const sellerToken = await getSellerToken();
    const { token } = await createDisposableCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, quantity: 4 });
    await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${token}`);

    const response = await request(app)
      .put(`/api/v1/inventory/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ totalStock: 3 });

    expect(response.status).toBe(409);
  });

  it('lists products at or below their low-stock threshold', async () => {
    const sellerToken = await getSellerToken();
    const lowId = await createProductWithStock(sellerToken, 5);
    const healthyId = await createProductWithStock(sellerToken, 50);

    const response = await request(app)
      .get('/api/v1/inventory/low-stock')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(response.status).toBe(200);
    const ids = response.body.products.map((product: { productId: string }) => product.productId);
    expect(ids).toContain(lowId);
    expect(ids).not.toContain(healthyId);
  });

  it('forbids customers from changing stock', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10);

    const response = await request(app)
      .put(`/api/v1/inventory/${productId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ totalStock: 1000 });

    expect(response.status).toBe(403);
  });
});
