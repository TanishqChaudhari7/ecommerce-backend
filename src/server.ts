import { app } from './app';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { startConsumers } from './consumers';

const server = app.listen(env.port, () => {
  logger.info(`Server listening on port ${env.port} [${env.nodeEnv}]`);
});

startConsumers().catch((error) => {
  logger.error('Failed to start Kafka consumers', { error });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

export { server };
