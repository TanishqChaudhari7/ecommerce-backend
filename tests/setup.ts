import { execSync } from 'child_process';
import { Pool } from 'pg';
import { pool } from '../src/config/db';
import { redis, deleteKeysByPattern } from '../src/config/redis';
import { disconnectProducer } from '../src/config/kafka';
import { env } from '../config/env';
import { seed, ALL_TABLES } from '../seeds/seed';

jest.setTimeout(30000);

async function ensureTestDatabaseExists(): Promise<void> {
  const dbUrl = new URL(env.databaseUrl);
  const dbName = dbUrl.pathname.replace(/^\//, '');

  const adminUrl = new URL(env.databaseUrl);
  adminUrl.pathname = '/postgres';

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const result = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (result.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await adminPool.end();
  }
}

function runMigrations(): void {
  // node-pg-migrate's bundle is ESM-only and can't be parsed by ts-jest if
  // imported directly into a test file's module graph, so migrations are run
  // by shelling out to the same `scripts/migrate.ts` entrypoint `npm run
  // migrate` uses, in its own separate ts-node process.
  try {
    execSync('npx ts-node scripts/migrate.ts', {
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'pipe',
    });
  } catch (error) {
    const execError = error as { stdout?: Buffer; stderr?: Buffer };
    // eslint-disable-next-line no-console
    console.error(execError.stdout?.toString(), execError.stderr?.toString());
    throw error;
  }
}

beforeAll(async () => {
  await ensureTestDatabaseExists();
  runMigrations();

  // The test database is fully disposable, so each test file starts from a
  // truly clean slate rather than an incrementally-seeded one - otherwise
  // throwaway data a previous run's tests left behind (e.g. items sitting in
  // the seeded customer's shared cart) can silently poison later runs.
  await pool.query(`TRUNCATE TABLE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE;`);
  await seed();

  // Give this test file a clean rate-limit budget so its own logins (direct
  // or via the getXToken() helpers) don't trip the login/register limiters.
  await deleteKeysByPattern('ratelimit:*');
});

afterAll(async () => {
  await redis.quit();
  await pool.end();
  await disconnectProducer();
});
