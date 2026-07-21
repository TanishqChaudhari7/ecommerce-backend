import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import ms from 'ms';
import { pool } from '../../config/db';
import { env } from '../../../config/env';
import { AppError } from '../../utils/AppError';
import { AccessTokenPayload, PublicUser, RegisterInput, TokenPair, UserRow } from './auth.types';

const BCRYPT_ROUNDS = 12;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function issueTokenPair(user: UserRow): Promise<TokenPair> {
  const payload: AccessTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });

  const refreshToken = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date(Date.now() + ms(env.jwtRefreshExpiresIn as ms.StringValue));

  await pool.query(
    `INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, $3)`,
    [user.id, refreshToken, expiresAt],
  );

  return { accessToken, refreshToken };
}

export class AuthService {
  async register(input: RegisterInput): Promise<PublicUser> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    try {
      const result = await pool.query<UserRow>(
        `INSERT INTO users (email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [input.email, passwordHash, input.firstName, input.lastName, input.role],
      );
      return toPublicUser(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'Email already registered');
      }
      throw error;
    }
  }

  async login(email: string, password: string): Promise<TokenPair & { user: PublicUser }> {
    const result = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !user.is_active) {
      throw new AppError(401, 'Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw new AppError(401, 'Invalid email or password');
    }

    const tokens = await issueTokenPair(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  async refresh(oldRefreshToken: string): Promise<TokenPair> {
    const sessionResult = await pool.query(
      'SELECT id, user_id, expires_at FROM sessions WHERE refresh_token = $1',
      [oldRefreshToken],
    );
    const session = sessionResult.rows[0];

    if (!session) {
      throw new AppError(401, 'Invalid refresh token');
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [session.id]);
      throw new AppError(401, 'Refresh token expired');
    }

    const userResult = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [
      session.user_id,
    ]);
    const user = userResult.rows[0];

    if (!user || !user.is_active) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [session.id]);
      throw new AppError(401, 'User no longer active');
    }

    await pool.query('DELETE FROM sessions WHERE id = $1', [session.id]);

    return issueTokenPair(user);
  }

  async logout(refreshToken: string): Promise<void> {
    await pool.query('DELETE FROM sessions WHERE refresh_token = $1', [refreshToken]);
  }

  async getMe(userId: string): Promise<PublicUser> {
    const result = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    return toPublicUser(user);
  }
}

export const authService = new AuthService();
