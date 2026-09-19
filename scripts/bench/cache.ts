/**
 * Metric A - product retrieval latency, Postgres vs Redis cache hit.
 *
 * Both arms hit the same endpoint (GET /api/v1/products/:id) against a catalog of
 * CATALOG_SIZE products, so the DB path does real index+join work rather than
 * trivially scanning the 20-row seed. The cold arm deletes each product's cache key
 * immediately before requesting it, so every sample takes the Postgres path; the warm
 * arm pre-populates the keys, so every sample is served from Redis.
 */
import { pool } from '../../src/config/db';
import { redis } from '../../src/config/redis';
import {
  cleanupBenchData,
  fmt,
  getProduct,
  pctChange,
  printStats,
  runConcurrent,
  seedCatalog,
  summarize,
} from './lib';

const CATALOG_SIZE = 8000;
const SEQ_SAMPLES = 200;
const WARMUP = 50;
const CONCURRENCY = 50;
const CONCURRENT_REQUESTS = 2000;

async function main(): Promise<void> {
  process.stdout.write(`seeding ${CATALOG_SIZE} products...\n`);
  const catalog = await seedCatalog(CATALOG_SIZE);

  // Warm up JIT / pools / page cache on ids that none of the measured arms touch.
  const warmupIds = catalog.slice(0, WARMUP);
  for (const productId of warmupIds) {
    await getProduct(productId);
  }

  // Each arm gets its own slice of never-before-requested ids. The service caches on
  // read with a 10min TTL, so a first request to a fresh id is guaranteed a miss and a
  // second request to the same id is guaranteed a hit - no client-side cache eviction
  // needed, which keeps both arms doing identical work.
  let cursor = WARMUP;
  const take = (count: number): string[] => {
    const slice = catalog.slice(cursor, cursor + count);
    cursor += count;
    return slice;
  };

  // --- sequential latency ---
  const seqCold = take(SEQ_SAMPLES);
  const cold: number[] = [];
  for (const productId of seqCold) {
    cold.push(await getProduct(productId)); // first touch => cache miss
  }
  const warm: number[] = [];
  for (const productId of seqCold) {
    warm.push(await getProduct(productId)); // second touch => cache hit
  }

  const coldStats = summarize(cold);
  const warmStats = summarize(warm);

  // --- throughput under concurrency ---
  const concIds = take(CONCURRENT_REQUESTS);
  const coldRun = await runConcurrent(CONCURRENT_REQUESTS, CONCURRENCY, (index) =>
    getProduct(concIds[index]),
  );
  const warmRun = await runConcurrent(CONCURRENT_REQUESTS, CONCURRENCY, (index) =>
    getProduct(concIds[index]),
  );

  const coldConc = summarize(coldRun.results);
  const warmConc = summarize(warmRun.results);
  const coldRps = (CONCURRENT_REQUESTS / coldRun.wallMs) * 1000;
  const warmRps = (CONCURRENT_REQUESTS / warmRun.wallMs) * 1000;

  process.stdout.write(`\n=== Metric A: product retrieval latency (catalog=${CATALOG_SIZE}) ===\n`);
  process.stdout.write('\n-- sequential (1 request at a time) --\n');
  printStats('cache MISS (Postgres)', coldStats);
  printStats('cache HIT  (Redis)', warmStats);
  process.stdout.write(
    `mean: ${fmt(coldStats.mean)}ms -> ${fmt(warmStats.mean)}ms (${fmt(pctChange(coldStats.mean, warmStats.mean), 1)}%)  ` +
      `p95: ${fmt(coldStats.p95)}ms -> ${fmt(warmStats.p95)}ms (${fmt(pctChange(coldStats.p95, warmStats.p95), 1)}%)\n`,
  );

  process.stdout.write(
    `\n-- concurrent (${CONCURRENCY} in flight, ${CONCURRENT_REQUESTS} requests) --\n`,
  );
  printStats('cache MISS (Postgres)', coldConc);
  printStats('cache HIT  (Redis)', warmConc);
  process.stdout.write(
    `mean: ${fmt(coldConc.mean)}ms -> ${fmt(warmConc.mean)}ms (${fmt(pctChange(coldConc.mean, warmConc.mean), 1)}%)  ` +
      `p95: ${fmt(coldConc.p95)}ms -> ${fmt(warmConc.p95)}ms (${fmt(pctChange(coldConc.p95, warmConc.p95), 1)}%)\n` +
      `throughput: ${fmt(coldRps, 0)} rps -> ${fmt(warmRps, 0)} rps (${fmt(pctChange(coldRps, warmRps), 1)}%)\n`,
  );

  await cleanupBenchData();
  await redis.quit();
  await pool.end();
}

main().catch((error) => {
  process.stderr.write(`cache bench failed: ${String(error)}\n`);
  process.exit(1);
});
