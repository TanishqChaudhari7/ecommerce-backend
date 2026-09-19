import request from 'supertest';
import { app } from '../../src/app';
import { getSellerToken } from '../helpers/auth';

// Seeded "Electronics" category (seeds/seed.ts).
const ELECTRONICS_ID = '00000002-0000-4000-8000-000000000001';

// A word no seeded product contains, so each search only matches this file's products.
const MARKER = `zephyr${Date.now().toString(36)}`;

async function createProduct(
  sellerToken: string,
  fields: { name: string; price: number; brand?: string; categoryId?: string },
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ ...fields, sku: `SEARCH-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  return response.body.product.id;
}

describe('Search API', () => {
  let cheapId: string;
  let priceyId: string;

  beforeAll(async () => {
    const sellerToken = await getSellerToken();
    cheapId = await createProduct(sellerToken, {
      name: `${MARKER} Desk Lamp`,
      price: 15,
      brand: 'Lumen',
      categoryId: ELECTRONICS_ID,
    });
    priceyId = await createProduct(sellerToken, {
      name: `${MARKER} Floor Lamp`,
      price: 120,
      brand: 'Halo',
    });
  });

  it('matches products by full-text query', async () => {
    const response = await request(app).get('/api/v1/search').query({ q: MARKER });

    expect(response.status).toBe(200);
    const ids = response.body.products.map((product: { id: string }) => product.id);
    expect(ids.sort()).toEqual([cheapId, priceyId].sort());
    expect(response.body.pagination.total).toBe(2);
  });

  it('stems words, so a plural query matches a singular name', async () => {
    const response = await request(app)
      .get('/api/v1/search')
      .query({ q: `${MARKER} lamps` });

    expect(response.body.pagination.total).toBe(2);
  });

  it('filters by category slug, price range and brand', async () => {
    const byCategory = await request(app)
      .get('/api/v1/search')
      .query({ q: MARKER, category: 'electronics' });
    expect(byCategory.body.products.map((p: { id: string }) => p.id)).toEqual([cheapId]);

    const byPrice = await request(app)
      .get('/api/v1/search')
      .query({ q: MARKER, minPrice: 100, maxPrice: 200 });
    expect(byPrice.body.products.map((p: { id: string }) => p.id)).toEqual([priceyId]);

    const byBrand = await request(app).get('/api/v1/search').query({ q: MARKER, brand: 'lumen' });
    expect(byBrand.body.products.map((p: { id: string }) => p.id)).toEqual([cheapId]);
  });

  it('sorts by price in either direction', async () => {
    const ascending = await request(app)
      .get('/api/v1/search')
      .query({ q: MARKER, sortBy: 'price', sortOrder: 'asc' });
    expect(ascending.body.products.map((p: { id: string }) => p.id)).toEqual([cheapId, priceyId]);

    const descending = await request(app)
      .get('/api/v1/search')
      .query({ q: MARKER, sortBy: 'price', sortOrder: 'desc' });
    expect(descending.body.products.map((p: { id: string }) => p.id)).toEqual([priceyId, cheapId]);
  });

  it('never serves a cached page that predates a product update', async () => {
    const sellerToken = await getSellerToken();
    const before = await request(app).get('/api/v1/search').query({ q: MARKER });
    expect(before.body.pagination.total).toBe(2);

    await request(app)
      .put(`/api/v1/products/${priceyId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: 99 });

    const after = await request(app).get('/api/v1/search').query({ q: MARKER });
    const updated = after.body.products.find((p: { id: string }) => p.id === priceyId);
    expect(updated.price).toBe(99);
  });

  it('returns 422 for an invalid sort column', async () => {
    const response = await request(app)
      .get('/api/v1/search')
      .query({ q: MARKER, sortBy: 'password_hash' });

    expect(response.status).toBe(422);
  });
});
