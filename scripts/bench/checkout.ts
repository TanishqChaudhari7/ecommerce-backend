/**
 * Metric C - checkout (POST /api/v1/orders) latency, plus a deadlock probe.
 *
 * Run once against the current code for a baseline, then again after optimizing
 * placeOrder. Carts hold ITEMS_PER_CART items because the per-item work in placeOrder
 * (one UPDATE inventory and one INSERT order_items per item, each its own round trip)
 * is what the optimization targets - a single-item cart would hide it.
 *
 * Two cart shapes, because they exercise different things:
 *   disjoint   - every buyer's 5 products are unique to that buyer, so concurrent
 *                checkouts never contend. This is the clean latency comparison.
 *   overlapping- buyers share products in rotating order, so concurrent checkouts
 *                acquire the same inventory row locks in different orders. This is
 *                the deadlock probe.
 *
 * Usage: ts-node scripts/bench/checkout.ts [label]
 */
import { writeFileSync } from 'fs';
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import {
  cleanupBenchData,
  placeOrder,
  printStats,
  provisionBuyers,
  runConcurrent,
  seedCatalog,
  summarize,
  OrderOutcome,
} from './lib';

const ITEMS_PER_CART = 5;
const SAMPLES = 250;
const WARMUP = 25;
const CONCURRENCY = 32;
const PROBE_BUYERS = 200;
const OVERLAP_POOL = 20;

function describeFailures(results: OrderOutcome[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    if (result.status !== 201) {
      const key = `${result.status}: ${result.message ?? 'unknown'}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

async function main(): Promise<void> {
  const label = process.argv[2] ?? 'run';

  // Both arms must see the same Redis keyspace: placeOrder calls deleteKeysByPattern,
  // whose SCAN cost scales with total key count, not just matching keys.
  await redis.flushall();

  // Enough products that every buyer in the latency arms gets a private set of 5.
  const needed = (WARMUP + SAMPLES * 2) * ITEMS_PER_CART;
  const catalog = await seedCatalog(needed, 100000);
  let cursor = 0;
  const disjoint = (): ((index: number) => string[]) => {
    const base = cursor;
    cursor += 0; // slices are handed out per buyer below
    return (index: number) =>
      catalog.slice(base + index * ITEMS_PER_CART, base + (index + 1) * ITEMS_PER_CART);
  };

  const warmupPick = disjoint();
  cursor += WARMUP * ITEMS_PER_CART;
  const warmupTokens = await provisionBuyers(WARMUP, warmupPick);
  for (const token of warmupTokens) {
    await placeOrder(token);
  }

  const seqPick = disjoint();
  cursor += SAMPLES * ITEMS_PER_CART;
  const seqTokens = await provisionBuyers(SAMPLES, seqPick);
  const seq: number[] = [];
  for (const token of seqTokens) {
    const outcome = await placeOrder(token);
    if (outcome.status !== 201) {
      throw new Error(`sequential checkout failed: ${outcome.status} ${outcome.message ?? ''}`);
    }
    seq.push(outcome.ms);
  }

  const concPick = disjoint();
  cursor += SAMPLES * ITEMS_PER_CART;
  const concTokens = await provisionBuyers(SAMPLES, concPick);
  const concRun = await runConcurrent<OrderOutcome>(SAMPLES, CONCURRENCY, (index) =>
    placeOrder(concTokens[index]),
  );
  const concFailures = describeFailures(concRun.results);

  // --- deadlock probe: overlapping carts, concurrent ---
  const probeCatalog = await seedCatalog(OVERLAP_POOL, 100000);
  // Half the buyers add their items in the opposite order to the other half. If
  // placeOrder acquired inventory locks in a deterministic global order (e.g. sorted
  // by product_id) the insertion order would not matter; if it locks in whatever order
  // the join happens to emit, these two groups deadlock against each other.
  const probeTokens = await provisionBuyers(PROBE_BUYERS, (index) => {
    const window = Array.from(
      { length: ITEMS_PER_CART },
      (_, i) => probeCatalog[(index + i) % OVERLAP_POOL],
    );
    return index % 2 === 0 ? window : window.reverse();
  });
  const probeRun = await runConcurrent<OrderOutcome>(PROBE_BUYERS, CONCURRENCY, (index) =>
    placeOrder(probeTokens[index]),
  );
  const probeFailures = describeFailures(probeRun.results);
  const probeOk = probeRun.results.filter((result) => result.status === 201).length;

  const seqStats = summarize(seq);
  const concStats = summarize(concRun.results.map((result) => result.ms));

  process.stdout.write(
    `\n=== Metric C: checkout latency [${label}] (cart=${ITEMS_PER_CART} items) ===\n`,
  );
  printStats('sequential', seqStats);
  printStats(`concurrent (${CONCURRENCY} in flight)`, concStats);
  process.stdout.write(`concurrent failures: ${JSON.stringify(concFailures)}\n`);
  process.stdout.write(
    `\n-- deadlock probe: ${PROBE_BUYERS} overlapping carts, ${CONCURRENCY} in flight --\n` +
      `succeeded: ${probeOk}/${PROBE_BUYERS}\n` +
      `failures:  ${JSON.stringify(probeFailures)}\n`,
  );

  writeFileSync(
    `${process.env.BENCH_OUT ?? '.'}/checkout-${label}.json`,
    JSON.stringify(
      {
        label,
        sequential: seqStats,
        concurrent: concStats,
        concurrentFailures: concFailures,
        probe: { buyers: PROBE_BUYERS, succeeded: probeOk, failures: probeFailures },
      },
      null,
      2,
    ),
  );
  process.stdout.write(`saved checkout-${label}.json\n`);

  await cleanupBenchData();
  await redis.quit();
  await pool.end();
}

main().catch((error) => {
  process.stderr.write(`checkout bench failed: ${String(error)}\n`);
  process.exit(1);
});
