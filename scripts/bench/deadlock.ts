/**
 * Deadlock probe for placeOrder's inventory locking.
 *
 * Buyers share a small pool of products, and half of them hold their cart items in the
 * reverse order of the other half. If placeOrder acquires inventory row locks in a
 * deterministic global order, insertion order is irrelevant and every checkout
 * succeeds. If it locks in whatever order the join emits, the two groups deadlock.
 *
 * Usage: ts-node scripts/bench/deadlock.ts [label]
 */
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import {
  cleanupBenchData,
  placeOrder,
  provisionBuyers,
  runConcurrent,
  seedCatalog,
  OrderOutcome,
} from './lib';

const BUYERS = 200;
const ITEMS_PER_CART = 5;
const OVERLAP_POOL = 20;
const CONCURRENCY = 32;

async function main(): Promise<void> {
  const label = process.argv[2] ?? 'run';
  const catalog = await seedCatalog(OVERLAP_POOL, 100000);

  const tokens = await provisionBuyers(BUYERS, (index) => {
    const window = Array.from(
      { length: ITEMS_PER_CART },
      (_, i) => catalog[(index + i) % OVERLAP_POOL],
    );
    return index % 2 === 0 ? window : window.reverse();
  });

  const { results } = await runConcurrent<OrderOutcome>(BUYERS, CONCURRENCY, (index) =>
    placeOrder(tokens[index]),
  );

  const counts: Record<string, number> = {};
  for (const result of results) {
    const key = result.status === 201 ? 'ok' : `${result.status}: ${result.message ?? 'unknown'}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  process.stdout.write(`[${label}] ${BUYERS} overlapping carts @ ${CONCURRENCY} concurrent\n`);
  process.stdout.write(`  ${JSON.stringify(counts)}\n`);

  await cleanupBenchData();
  await redis.quit();
  await pool.end();
}

main().catch((error) => {
  process.stderr.write(`deadlock probe failed: ${String(error)}\n`);
  process.exit(1);
});
