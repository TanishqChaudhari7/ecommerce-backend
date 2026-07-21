import { app } from './app';
import { env } from '../config/env';
import { logger } from '../config/logger';

const server = app.listen(env.port, () => {
  logger.info(`Server listening on port ${env.port} [${env.nodeEnv}]`);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

export { server };
