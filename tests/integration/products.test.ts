import request from 'supertest';
import { app } from '../../src/app';
import { getSellerToken, getCustomerToken, uniqueEmail } from '../helpers/auth';

function freshSku(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe('Products API', () => {
  it('GET /products returns a paginated list excluding soft-deleted products', async () => {
    const sellerToken = await getSellerToken();
    const createResponse = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Listing Test Product', price: 9.99, sku: freshSku('LIST-TEST') });
    const productId = createResponse.body.product.id;

    await request(app)
      .delete(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`);

    const listResponse = await request(app).get('/api/v1/products?page=1&limit=100');

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.pagination).toEqual(expect.objectContaining({ page: 1, limit: 100 }));
    const ids = listResponse.body.products.map((product: { id: string }) => product.id);
    expect(ids).not.toContain(productId);
  });

  it('GET /products/:id returns a product with availableStock', async () => {
    const sellerToken = await getSellerToken();
    const createResponse = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Detail Test Product', price: 15, sku: freshSku('DETAIL-TEST') });
    const productId = createResponse.body.product.id;

    const response = await request(app).get(`/api/v1/products/${productId}`);

    expect(response.status).toBe(200);
    expect(response.body.product.availableStock).toBe(0);
  });

  it('POST /products as seller returns 201', async () => {
    const sellerToken = await getSellerToken();

    const response = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Seller Create Test', price: 5, sku: freshSku('SELLER-CREATE') });

    expect(response.status).toBe(201);
  });

  it('POST /products as customer returns 403', async () => {
    const customerToken = await getCustomerToken();

    const response = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ name: 'Customer Create Test', price: 5, sku: freshSku('CUSTOMER-CREATE') });

    expect(response.status).toBe(403);
  });

  it('PUT /products/:id as owner returns 200', async () => {
    const sellerToken = await getSellerToken();
    const createResponse = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Update Test', price: 20, sku: freshSku('UPDATE-TEST') });
    const productId = createResponse.body.product.id;

    const response = await request(app)
      .put(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 25 });

    expect(response.status).toBe(200);
    expect(response.body.product.price).toBe(25);
  });

  it('PUT /products/:id as a non-owner seller returns 403', async () => {
    const sellerToken = await getSellerToken();
    const createResponse = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Non-owner Test', price: 20, sku: freshSku('NONOWNER-TEST') });
    const productId = createResponse.body.product.id;

    const otherSellerEmail = uniqueEmail('otherseller');
    await request(app).post('/api/v1/auth/register').send({
      email: otherSellerEmail,
      password: 'Sup3rSecret!',
      firstName: 'Other',
      lastName: 'Seller',
      role: 'seller',
    });
    const otherLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: otherSellerEmail, password: 'Sup3rSecret!' });
    const otherToken = otherLogin.body.accessToken;

    const response = await request(app)
      .put(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ price: 999 });

    expect(response.status).toBe(403);
  });

  it('DELETE /products/:id soft deletes; product no longer in list', async () => {
    const sellerToken = await getSellerToken();
    const createResponse = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Delete Test', price: 20, sku: freshSku('DELETE-TEST') });
    const productId = createResponse.body.product.id;

    const deleteResponse = await request(app)
      .delete(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(deleteResponse.status).toBe(204);

    const getResponse = await request(app).get(`/api/v1/products/${productId}`);
    expect(getResponse.status).toBe(404);
  });
});
