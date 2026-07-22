import request from 'supertest';
import { app } from '../../src/app';
import { getSellerToken, getCustomerToken } from '../helpers/auth';

function freshSku(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createProductWithStock(
  sellerToken: string,
  stock: number,
  isAvailable = true,
): Promise<string> {
  const createResponse = await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ name: 'Cart Test Product', price: 10, sku: freshSku('CART-TEST'), isAvailable });
  const productId = createResponse.body.product.id;

  await request(app)
    .put(`/api/v1/inventory/${productId}`)
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ totalStock: stock });

  return productId;
}

function findItem(cart: { items: { productId: string }[] }, productId: string) {
  return cart.items.find((item) => item.productId === productId);
}

describe('Cart API', () => {
  it('adds an item to the cart successfully', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10);

    const response = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 2 });

    expect(response.status).toBe(201);
    const item = findItem(response.body.cart, productId);
    expect(item).toBeDefined();
    expect(item.quantity).toBe(2);

    await request(app)
      .delete(`/api/v1/cart/items/${productId}`)
      .set('Authorization', `Bearer ${customerToken}`);
  });

  it('returns 400 when quantity exceeds available stock', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 2);

    const response = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 5 });

    expect(response.status).toBe(400);
  });

  it('returns 400 for an unavailable product', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10, false);

    const response = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 1 });

    expect(response.status).toBe(400);
  });

  it('updates the quantity of an item already in the cart', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 1 });

    const response = await request(app)
      .put(`/api/v1/cart/items/${productId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ quantity: 3 });

    expect(response.status).toBe(200);
    const item = findItem(response.body.cart, productId);
    expect(item.quantity).toBe(3);

    await request(app)
      .delete(`/api/v1/cart/items/${productId}`)
      .set('Authorization', `Bearer ${customerToken}`);
  });

  it('removes an item from the cart', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 1 });

    const response = await request(app)
      .delete(`/api/v1/cart/items/${productId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(findItem(response.body.cart, productId)).toBeUndefined();
  });

  it('clears the cart', async () => {
    const sellerToken = await getSellerToken();
    const customerToken = await getCustomerToken();
    const productId = await createProductWithStock(sellerToken, 10);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 1 });

    const response = await request(app)
      .delete('/api/v1/cart')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(response.status).toBe(204);

    const cart = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(cart.body.cart.items).toHaveLength(0);
  });
});
