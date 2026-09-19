/**
 * Metric B - order placement throughput, sequential vs concurrent.
 *
 * Measured twice, because the two cases behave very differently:
 *   spread    - every order targets a different product, so the `FOR UPDATE OF i` row
 *               locks in placeOrder never collide.
 *   contended - every order targets the SAME product (a hot item), so every order
 *               serializes on one inventory row.
 */
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import {
  cleanupBenchData,
  createBenchProduct,
  fmt,
  pctChange,
  placeOrder,
  printStats,
  provisionBuyers,
  runConcurrent,
  seedCatalog,
  summarize,
  OrderOutcome,
} from './lib';

const ORDERS_PER_ARM = 300;
const CONCURRENCY = 32;

interface ArmResult {
  rps: number;
  succeeded: number;
  failed: number;
  latency: ReturnType<typeof summarize>;
}

async function runArm(tokens: string[], concurrency: number): Promise<ArmResult> {
  const { results, wallMs } = await runConcurrent<OrderOutcome>(
    tokens.length,
    concurrency,
    (index) => placeOrder(tokens[index]),
  );
  const succeeded = results.filter((result) => result.status === 201).length;
  return {
    rps: (succeeded / wallMs) * 1000,
    succeeded,
    failed: results.length - succeeded,
    latency: summarize(results.map((result) => result.ms)),
  };
}

function report(label: string, sequential: ArmResult, concurrent: ArmResult): void {
  process.stdout.write(`\n-- ${label} --\n`);
  printStats(`sequential (1 in flight)`, sequential.latency);
  printStats(`concurrent (${CONCURRENCY} in flight)`, concurrent.latency);
  process.stdout.write(
    `orders ok: ${sequential.succeeded}/${ORDERS_PER_ARM} seq, ${concurrent.succeeded}/${ORDERS_PER_ARM} conc\n` +
      `throughput: ${fmt(sequential.rps, 1)} orders/s -> ${fmt(concurrent.rps, 1)} orders/s ` +
      `(${fmt(pctChange(sequential.rps, concurrent.rps), 1)}%, ${fmt(concurrent.rps / sequential.rps)}x)\n`,
  );
}

async function main(): Promise<void> {
  // --- spread: one product per order, no lock contention ---
  const catalog = await seedCatalog(ORDERS_PER_ARM * 2, 10);
  const spreadSeqTokens = await provisionBuyers(ORDERS_PER_ARM, (index) => [catalog[index]]);
  const spreadConcTokens = await provisionBuyers(ORDERS_PER_ARM, (index) => [
    catalog[ORDERS_PER_ARM + index],
  ]);

  await placeOrder(spreadSeqTokens[0]); // warm up the order path
  const spreadSeq = await runArm(spreadSeqTokens.slice(1), 1);
  const spreadConc = await runArm(spreadConcTokens, CONCURRENCY);

  // --- contended: every order fights over one inventory row ---
  const hotProduct = await createBenchProduct(ORDERS_PER_ARM * 2 + 10);
  const hotSeqTokens = await provisionBuyers(ORDERS_PER_ARM, () => [hotProduct]);
  const hotConcTokens = await provisionBuyers(ORDERS_PER_ARM, () => [hotProduct]);

  const hotSeq = await runArm(hotSeqTokens, 1);
  const hotConc = await runArm(hotConcTokens, CONCURRENCY);

  process.stdout.write(`\n=== Metric B: order throughput (${ORDERS_PER_ARM} orders per arm) ===\n`);
  report('spread (distinct product per order)', spreadSeq, spreadConc);
  report('contended (all orders, one product)', hotSeq, hotConc);

  await cleanupBenchData();
  await redis.quit();
  await pool.end();
}

main().catch((error) => {
  process.stderr.write(`throughput bench failed: ${String(error)}\n`);
  process.exit(1);
});
