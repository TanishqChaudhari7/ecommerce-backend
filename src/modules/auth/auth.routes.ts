import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticateToken } from '../../middleware/authenticateToken';
import { rateLimit } from '../../middleware/rateLimiter';
import { validateBody } from '../../middleware/validate';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from './auth.validation';

const router = Router();

const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyPrefix: 'register',
});

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'login',
});

/**
 * @openapi
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, firstName, lastName]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               role: { type: string, enum: [customer, seller, admin], default: customer }
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Validation failed
 *       409:
 *         description: Email already registered
 *       429:
 *         description: Too many registration attempts from this IP
 */
router.post(
  '/register',
  registerRateLimit,
  validateBody(registerSchema),
  authController.register.bind(authController),
);

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     summary: Log in and receive an access/refresh token pair
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful, returns accessToken, refreshToken, and user
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Invalid email or password
 *       429:
 *         description: Too many login attempts from this IP
 */
router.post(
  '/login',
  loginRateLimit,
  validateBody(loginSchema),
  authController.login.bind(authController),
);

/**
 * @openapi
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Rotate a refresh token for a new access/refresh token pair
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: New accessToken and refreshToken
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Refresh token invalid, expired, or user no longer active
 */
router.post('/refresh', validateBody(refreshSchema), authController.refresh.bind(authController));

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     summary: Log out by invalidating a refresh token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       204:
 *         description: Logged out
 *       400:
 *         description: Validation failed
 */
router.post('/logout', validateBody(logoutSchema), authController.logout.bind(authController));

/**
 * @openapi
 * /api/v1/auth/me:
 *   get:
 *     summary: Get the currently authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The current user
 *       401:
 *         description: Missing, invalid, or expired access token
 *       404:
 *         description: User no longer exists
 */
router.get('/me', authenticateToken, authController.me.bind(authController));

export default router;
