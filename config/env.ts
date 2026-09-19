import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function get(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const isTest = get('NODE_ENV', 'development') === 'test';

// The 'change-me' fallback is a local-development convenience; in production it
// would let anyone who has read this file forge access tokens.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}

export const env = {
  nodeEnv: get('NODE_ENV', 'development'),
  port: parseInt(get('PORT', '3000'), 10),
  databaseUrl: isTest
    ? get('TEST_DATABASE_URL', 'postgresql://ecommerce:ecommerce@localhost:5432/ecommerce_test')
    : get('DATABASE_URL', 'postgresql://ecommerce:ecommerce@localhost:5432/ecommerce'),
  redisUrl: get('REDIS_URL', 'redis://localhost:6379'),
  kafkaBrokers: get('KAFKA_BROKERS', 'localhost:9092').split(','),
  kafkaClientId: get('KAFKA_CLIENT_ID', 'ecommerce-backend'),
  jwtSecret: get('JWT_SECRET', 'change-me'),
  jwtExpiresIn: get('JWT_EXPIRES_IN', '15m'),
  jwtRefreshExpiresIn: get('JWT_REFRESH_EXPIRES_IN', '7d'),
  logLevel: get('LOG_LEVEL', 'http'),
  isProduction: process.env.NODE_ENV === 'production',
};
