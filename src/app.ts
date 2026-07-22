import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { register } from './config/metrics';
import { requestIdMiddleware } from './middleware/requestId';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './modules/auth/auth.routes';
import productsRoutes from './modules/products/products.routes';
import cartRoutes from './modules/cart/cart.routes';
import ordersRoutes from './modules/orders/orders.routes';
import paymentsRoutes from './modules/payments/payments.routes';
import inventoryRoutes from './modules/inventory/inventory.routes';
import searchRoutes from './modules/search/search.routes';

export function createApp(): Application {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);
  app.use(metricsMiddleware);

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/products', productsRoutes);
  app.use('/api/v1/cart', cartRoutes);
  app.use('/api/v1/orders', ordersRoutes);
  app.use('/api/v1/payments', paymentsRoutes);
  app.use('/api/v1/inventory', inventoryRoutes);
  app.use('/api/v1/search', searchRoutes);

  app.use(errorHandler);

  return app;
}

export const app = createApp();
