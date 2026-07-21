import { pool } from '../src/config/db';
import { redis } from '../src/config/redis';
import { disconnectProducer } from '../src/config/kafka';

afterAll(async () => {
  await redis.quit();
  await pool.end();
  await disconnectProducer();
});
