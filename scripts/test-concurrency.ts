import { randomUUID } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { pool } from '../src/config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const SEED_CUSTOMER_EMAIL = 'customer@test.com';
const SEED_CUSTOMER_PASSWORD = 'Test@1234';

interface OrderResult {
  index: number;
  status: number;
  orderId?: string;
  reason?: string;
}

async function loginAsSeedCustomer(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SEED_CUSTOMER_EMAIL, password: SEED_CUSTOMER_PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`Failed to log in as seed customer: ${response.status}`);
  }
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

/**
 * Creates an additional disposable customer directly in the database and signs a
 * matching access token, bypassing the register/login HTTP endpoints (and their
 * rate limiters) so `requestCount` can be set arbitrarily high without needing
 * `requestCount` real logins. Each concurrent order attempt needs its own cart,
 * hence its own customer identity.
 */
async function createDisposableCustomerToken(): Promise<string> {
  const userId = randomUUID();
  const email = `concurrency-cli-${userId}@test.com`;

  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, 'unused', 'Concurrency', 'CLI', 'customer')`,
    [userId, email],
  );

  return jwt.sign({ userId, email, role: 'customer' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });
}

async function addToCart(token: string, productId: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/v1/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ productId, quantity: 1 }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to add product ${productId} to cart: ${response.status} ${body}`);
  }
}

async function placeOrder(token: string, index: number): Promise<OrderResult> {
  const response = await fetch(`${BASE_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as {
    order?: { id: string };
    message?: string;
  };

  if (response.status === 201) {
    return { index, status: response.status, orderId: body.order?.id };
  }
  return { index, status: response.status, reason: body.message ?? 'unknown error' };
}

async function main(): Promise<void> {
  const [, , productId, requestCountArg] = process.argv;

  if (!productId || !requestCountArg) {
    logger.error('Usage: ts-node scripts/test-concurrency.ts <productId> <requestCount>');
    process.exit(1);
  }

  const requestCount = parseInt(requestCountArg, 10);

  logger.info(`Firing ${requestCount} simultaneous order requests for product ${productId}`);

  const tokens: string[] = [await loginAsSeedCustomer()];
  for (let i = 1; i < requestCount; i += 1) {
    tokens.push(await createDisposableCustomerToken());
  }

  for (const token of tokens) {
    await addToCart(token, productId);
  }

  const results = await Promise.all(tokens.map((token, index) => placeOrder(token, index)));

  for (const result of results) {
    if (result.status === 201) {
      logger.info(`Request #${result.index} — ${result.status} (${result.orderId})`);
    } else {
      logger.info(`Request #${result.index} — ${result.status} (${result.reason})`);
    }
  }

  const inventoryResult = await pool.query<{ total_stock: number; reserved_stock: number }>(
    'SELECT total_stock, reserved_stock FROM inventory WHERE product_id = $1',
    [productId],
  );
  const { total_stock: totalStock, reserved_stock: reservedStock } = inventoryResult.rows[0];
  const availableStock = totalStock - reservedStock;

  logger.info(
    `Final inventory: total_stock=${totalStock} reserved_stock=${reservedStock} availableStock=${availableStock}`,
  );
  logger.info(availableStock >= 0 ? 'PASS' : 'FAIL');

  await pool.end();
}

main().catch((error) => {
  logger.error('Concurrency test script failed', { error });
  process.exit(1);
});
