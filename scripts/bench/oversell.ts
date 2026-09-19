/**
 * Metric D - overselling under concurrency.
 *
 * BUYERS buyers each try to order one unit of a product that only has STOCK units,
 * all at once. A correct checkout confirms exactly STOCK orders and rejects the rest
 * with a clean 400; overselling means more orders were confirmed than there was stock,
 * or reserved_stock ended up above total_stock.
 *
 * Usage: ts-node scripts/bench/oversell.ts [label]
 */
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import {
  cleanupBenchData,
  createBenchProduct,
  inventoryOf,
  placeOrder,
  provisionBuyers,
  runConcurrent,
  OrderOutcome,
} from './lib';

const BUYERS = 200;
const STOCK = 50;
const CONCURRENCY = 64;

async function main(): Promise<void> {
  const label = process.argv[2] ?? 'run';
  const productId = await createBenchProduct(STOCK);
  const tokens = await provisionBuyers(BUYERS, () => [productId]);

  const { results } = await runConcurrent<OrderOutcome>(BUYERS, CONCURRENCY, (index) =>
    placeOrder(tokens[index]),
  );

  const confirmed = results.filter((result) => result.status === 201).length;
  const rejected = results.filter((result) => result.status === 400).length;
  const errored = results.filter((result) => result.status >= 500).length;
  const inventory = await inventoryOf(productId);

  const oversoldOrders = Math.max(0, confirmed - STOCK);
  const oversoldUnits = Math.max(0, inventory.reservedStock - inventory.totalStock);

  process.stdout.write(
    `\n[${label}] ${BUYERS} buyers, ${CONCURRENCY} concurrent, stock=${STOCK}\n` +
      `  confirmed (201):        ${confirmed}\n` +
      `  rejected  (400):        ${rejected}\n` +
      `  errored   (5xx):        ${errored}\n` +
      `  inventory total/reserved: ${inventory.totalStock}/${inventory.reservedStock}\n` +
      `  OVERSOLD orders:        ${oversoldOrders}\n` +
      `  OVERSOLD units:         ${oversoldUnits}\n`,
  );

  await cleanupBenchData();
  await redis.quit();
  await pool.end();
}

main().catch((error) => {
  process.stderr.write(`oversell bench failed: ${String(error)}\n`);
  process.exit(1);
});
