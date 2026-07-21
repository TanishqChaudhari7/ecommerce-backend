import { pool } from '../src/config/db';
import { redis } from '../src/config/redis';

afterAll(async () => {
  await redis.quit();
  await pool.end();
});
