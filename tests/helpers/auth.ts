import request from 'supertest';
import jwt, { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { app } from '../../src/app';
import { pool } from '../../src/config/db';
import { env } from '../../config/env';

const SEED_PASSWORD = 'Test@1234';

const tokenCache = new Map<string, string>();

async function loginAndCache(email: string): Promise<string> {
  const cached = tokenCache.get(email);
  if (cached) {
    return cached;
  }

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: SEED_PASSWORD });

  if (response.status !== 200) {
    throw new Error(
      `Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  const token = response.body.accessToken as string;
  tokenCache.set(email, token);
  return token;
}

export async function getCustomerToken(): Promise<string> {
  return loginAndCache('customer@test.com');
}

export async function getSellerToken(): Promise<string> {
  return loginAndCache('seller@test.com');
}

export async function getAdminToken(): Promise<string> {
  return loginAndCache('admin@test.com');
}

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
}

/**
 * Creates a disposable customer user directly in the database and signs a valid
 * access token for it, bypassing the register/login HTTP endpoints entirely (and
 * therefore their rate limiters). Used by tests that need many independent
 * customer identities in a single test run - e.g. the concurrency test, which
 * needs one cart per simultaneous order attempt and would otherwise blow through
 * the 5-per-15-minutes login limit almost immediately.
 */
export async function createDisposableCustomerToken(): Promise<{ userId: string; token: string }> {
  const userId = randomUUID();
  const email = `disposable-${userId}@test.com`;

  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, 'unused', 'Disposable', 'Customer', 'customer')`,
    [userId, email],
  );

  const token = jwt.sign({ userId, email, role: 'customer' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });

  return { userId, token };
}
