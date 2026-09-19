/**
 * Double-submit probe: one customer fires two POST /orders at the same moment with
 * the same cart. Correct behaviour is exactly one order per trial (one 201 and one
 * 400 Cart is empty) with the cart's units reserved once.
 *
 * Usage: ts-node scripts/bench/double-submit.ts
 */
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import {
  cleanupBenchData,
  createBenchProduct,
  createCustomer,
  inventoryOf,
  placeOrder,
  seedCart,
} from './lib';

const TRIALS = 10;
const CART_QUANTITY = 2;

async function main(): Promise<void> {
  let singleOrderTrials = 0;

  for (let trial = 1; trial <= TRIALS; trial += 1) {
    const productId = await createBenchProduct(100);
    const { userId, token } = await createCustomer();
    await seedCart(userId, [productId], CART_QUANTITY);

    const results = await Promise.all([placeOrder(token), placeOrder(token)]);
    const orders = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM orders WHERE user_id = $1',
      [userId],
    );
    const { reservedStock } = await inventoryOf(productId);
    if (orders.rows[0].n === 1) {
      singleOrderTrials += 1;
    }

    process.stdout.write(
      `trial ${trial}: statuses=${results.map((result) => result.status).join(',')} ` +
        `orders=${orders.rows[0].n} reserved=${reservedStock}\n`,
    );
  }

  process.stdout.write(`\ntrials with exactly one order: ${singleOrderTrials}/${TRIALS}\n`);

  await cleanupBenchData();
  await redis.quit();
  await pool.end();
}

main().catch((error) => {
  process.stderr.write(`double-submit probe failed: ${String(error)}\n`);
  process.exit(1);
});
