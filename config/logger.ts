import winston from 'winston';
import { env } from './env';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack }) => `${ts} [${level}] ${stack || message}`),
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

export const logger = winston.createLogger({
  level: env.logLevel,
  format: env.isProduction ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
});
