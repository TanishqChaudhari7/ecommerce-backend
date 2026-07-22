import request from 'supertest';
import { app } from '../../src/app';
import { pool } from '../../src/config/db';
import { getSellerToken, createDisposableCustomerToken } from '../helpers/auth';

const TOTAL_STOCK = 3;
const REQUEST_COUNT = 10;

describe('Concurrency: inventory safety under simultaneous order placement', () => {
  it(`never oversells: exactly ${TOTAL_STOCK} of ${REQUEST_COUNT} simultaneous orders succeed`, async () => {
    const sellerToken = await getSellerToken();

    const createResponse = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Concurrency Test Product', price: 10, sku: `CONCURRENCY-${Date.now()}` });
    const productId = createResponse.body.product.id;

    await request(app)
      .put(`/api/v1/inventory/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ totalStock: TOTAL_STOCK });

    // Each simultaneous "order attempt" needs its own cart, so each contender
    // gets its own disposable customer identity (bypassing register/login and
    // their rate limiters, since we need REQUEST_COUNT independent identities).
    const tokens: string[] = [];
    for (let i = 0; i < REQUEST_COUNT; i += 1) {
      const { token } = await createDisposableCustomerToken();
      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 });
      tokens.push(token);
    }

    const results = await Promise.all(
      tokens.map((token) =>
        request(app).post('/api/v1/orders').set('Authorization', `Bearer ${token}`),
      ),
    );

    const succeeded = results.filter((response) => response.status === 201);
    const failed = results.filter((response) => response.status !== 201);

    const inventoryResult = await pool.query<{ total_stock: number; reserved_stock: number }>(
      'SELECT total_stock, reserved_stock FROM inventory WHERE product_id = $1',
      [productId],
    );
    const { total_stock: totalStock, reserved_stock: reservedStock } = inventoryResult.rows[0];
    const availableStock = totalStock - reservedStock;

    const passed =
      succeeded.length === TOTAL_STOCK &&
      failed.length === REQUEST_COUNT - TOTAL_STOCK &&
      reservedStock === TOTAL_STOCK &&
      availableStock === 0;

    // eslint-disable-next-line no-console
    console.log(
      `[concurrency] ${passed ? 'PASS' : 'FAIL'} — succeeded=${succeeded.length} failed=${failed.length} ` +
        `reservedStock=${reservedStock} totalStock=${totalStock} availableStock=${availableStock}`,
    );

    expect(succeeded.length).toBe(TOTAL_STOCK);
    expect(failed.length).toBe(REQUEST_COUNT - TOTAL_STOCK);
    expect(reservedStock).toBe(TOTAL_STOCK);
    expect(availableStock).toBe(0);
    expect(availableStock).toBeGreaterThanOrEqual(0);
  });
});
