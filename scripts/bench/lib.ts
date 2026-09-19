import { randomUUID } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { pool } from '../../src/config/db';
import { env } from '../../config/env';

export const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

/** Seller that owns every bench product, so bench data is easy to identify and clean up. */
export const BENCH_SELLER_ID = '00000000-0000-4000-8000-00000000bee5';

export interface Stats {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** Percentage change from `before` to `after`, negative meaning a decrease. */
export function pctChange(before: number, after: number): number {
  return ((after - before) / before) * 100;
}

export async function ensureBenchSeller(): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
     VALUES ($1, 'bench-seller@bench.local', 'unused', 'Bench', 'Seller', 'seller')
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_SELLER_ID],
  );
}

/**
 * Creates a product with a known stock level directly in the database. Bypasses the
 * HTTP endpoints so bench setup is fast and is not itself part of what we measure.
 */
export async function createBenchProduct(stock: number, price = 10): Promise<string> {
  await ensureBenchSeller();
  const productId = randomUUID();
  await pool.query(
    `INSERT INTO products (id, seller_id, name, description, brand, sku, price, is_available, is_deleted)
     VALUES ($1, $2, $3, 'bench fixture product', 'BenchBrand', $4, $5, true, false)`,
    [
      productId,
      BENCH_SELLER_ID,
      `Bench Product ${productId.slice(0, 8)}`,
      `BENCH-${productId.slice(0, 8)}`,
      price,
    ],
  );
  await pool.query(
    `INSERT INTO inventory (product_id, total_stock, reserved_stock, low_stock_threshold)
     VALUES ($1, $2, 0, 0)`,
    [productId, stock],
  );
  return productId;
}

/**
 * Creates a disposable customer straight in the database and signs a matching access
 * token, bypassing register/login (and their rate limiters). Each concurrent order
 * attempt needs its own cart, hence its own customer identity.
 */
export async function createCustomer(): Promise<{ userId: string; token: string }> {
  const userId = randomUUID();
  const email = `bench-${userId}@bench.local`;
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, 'unused', 'Bench', 'Customer', 'customer')`,
    [userId, email],
  );
  const token = jwt.sign({ userId, email, role: 'customer' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });
  return { userId, token };
}

/** Seeds a cart with the given products directly in the database (setup, not measured). */
export async function seedCart(userId: string, productIds: string[], quantity = 1): Promise<void> {
  const cartResult = await pool.query<{ id: string }>(
    `INSERT INTO shopping_carts (user_id) VALUES ($1) RETURNING id`,
    [userId],
  );
  const cartId = cartResult.rows[0].id;
  for (const productId of productIds) {
    await pool.query(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)`, [
      cartId,
      productId,
      quantity,
    ]);
  }
}

export interface OrderOutcome {
  status: number;
  ms: number;
  message?: string;
}

export async function placeOrder(token: string): Promise<OrderOutcome> {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return { status: response.status, ms: performance.now() - started, message: body.message };
}

export async function getProduct(productId: string): Promise<number> {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/api/v1/products/${productId}`);
  await response.text();
  if (!response.ok) {
    throw new Error(`GET product ${productId} failed: ${response.status}`);
  }
  return performance.now() - started;
}

export async function inventoryOf(
  productId: string,
): Promise<{ totalStock: number; reservedStock: number; available: number }> {
  const result = await pool.query<{ total_stock: number; reserved_stock: number }>(
    'SELECT total_stock, reserved_stock FROM inventory WHERE product_id = $1',
    [productId],
  );
  const { total_stock: totalStock, reserved_stock: reservedStock } = result.rows[0];
  return { totalStock, reservedStock, available: totalStock - reservedStock };
}

/**
 * Removes every row this harness created, leaving the normal seed data intact.
 * Deletes in FK dependency order: orders/order_items reference users and products
 * with ON DELETE RESTRICT, so they have to go first.
 */
export async function cleanupBenchData(): Promise<void> {
  await pool.query(
    `DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bench-%@bench.local')`,
  );
  await pool.query(
    `DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bench-%@bench.local')`,
  );
  await pool.query(
    `DELETE FROM order_items WHERE product_id IN (SELECT id FROM products WHERE seller_id = $1)`,
    [BENCH_SELLER_ID],
  );
  await pool.query(
    `DELETE FROM cart_items WHERE product_id IN (SELECT id FROM products WHERE seller_id = $1)`,
    [BENCH_SELLER_ID],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE 'bench-%@bench.local' AND id <> $1`, [
    BENCH_SELLER_ID,
  ]);
  await pool.query(`DELETE FROM products WHERE seller_id = $1`, [BENCH_SELLER_ID]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [BENCH_SELLER_ID]);
}

export function printStats(label: string, stats: Stats): void {
  process.stdout.write(
    `${label.padEnd(34)} n=${String(stats.n).padStart(4)}  ` +
      `mean=${fmt(stats.mean).padStart(8)}ms  p50=${fmt(stats.p50).padStart(8)}ms  ` +
      `p95=${fmt(stats.p95).padStart(8)}ms  p99=${fmt(stats.p99).padStart(8)}ms\n`,
  );
}

/**
 * Bulk-inserts `count` products (each with an inventory row) owned by the bench seller,
 * so latency measurements run against a catalog of realistic size rather than the
 * 20-row seed. Returns the generated product ids.
 */
export async function seedCatalog(count: number, stock = 100): Promise<string[]> {
  await ensureBenchSeller();
  const ids: string[] = [];
  const BATCH = 500;
  for (let offset = 0; offset < count; offset += BATCH) {
    const size = Math.min(BATCH, count - offset);
    const batchIds = Array.from({ length: size }, () => randomUUID());
    await pool.query(
      `INSERT INTO products (id, seller_id, name, description, brand, sku, price, is_available, is_deleted)
       SELECT id, $2, 'Bench Catalog ' || left(id::text, 8),
              'bench catalog product for latency measurement', 'BenchBrand',
              'BENCHCAT-' || left(id::text, 12), 19.99, true, false
       FROM unnest($1::uuid[]) AS id`,
      [batchIds, BENCH_SELLER_ID],
    );
    await pool.query(
      `INSERT INTO inventory (product_id, total_stock, reserved_stock, low_stock_threshold)
       SELECT id, $2, 0, 0 FROM unnest($1::uuid[]) AS id`,
      [batchIds, stock],
    );
    ids.push(...batchIds);
  }
  return ids;
}

/**
 * Runs `total` tasks keeping at most `concurrency` in flight, returning every result
 * plus the wall-clock duration of the whole run (for throughput).
 */
export async function runConcurrent<T>(
  total: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
): Promise<{ results: T[]; wallMs: number }> {
  const results: T[] = new Array(total);
  let next = 0;
  const started = performance.now();

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= total) {
        return;
      }
      results[index] = await task(index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return { results, wallMs: performance.now() - started };
}

/**
 * Bulk-creates `count` disposable customers, each with a cart holding one unit of the
 * product chosen by `productFor(index)`. Doing this in bulk keeps provisioning out of
 * the measured window - the benchmark should time order placement, not fixture setup.
 */
export async function provisionBuyers(
  count: number,
  productsFor: (index: number) => string[],
): Promise<string[]> {
  const userIds = Array.from({ length: count }, () => randomUUID());
  const emails = userIds.map((id) => `bench-${id}@bench.local`);

  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
     SELECT u.id, u.email, 'unused', 'Bench', 'Buyer', 'customer'
     FROM unnest($1::uuid[], $2::text[]) AS u(id, email)`,
    [userIds, emails],
  );

  const cartResult = await pool.query<{ id: string; user_id: string }>(
    `INSERT INTO shopping_carts (user_id)
     SELECT id FROM unnest($1::uuid[]) AS id
     RETURNING id, user_id`,
    [userIds],
  );
  const cartByUser = new Map(cartResult.rows.map((row) => [row.user_id, row.id]));

  const cartIds: string[] = [];
  const productIds: string[] = [];
  userIds.forEach((userId, index) => {
    for (const productId of productsFor(index)) {
      cartIds.push(cartByUser.get(userId) as string);
      productIds.push(productId);
    }
  });
  await pool.query(
    `INSERT INTO cart_items (cart_id, product_id, quantity)
     SELECT c.cart_id, c.product_id, 1
     FROM unnest($1::uuid[], $2::uuid[]) AS c(cart_id, product_id)`,
    [cartIds, productIds],
  );

  return userIds.map((userId, index) =>
    jwt.sign({ userId, email: emails[index], role: 'customer' }, env.jwtSecret, {
      expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
    }),
  );
}
