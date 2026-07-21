import express, { Application } from 'express';
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

  app.use(express.json());
  app.use(requestLogger);

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

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
