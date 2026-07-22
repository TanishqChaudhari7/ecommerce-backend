import winston from 'winston';
import { env } from './env';
import { getRequestId } from '../src/utils/requestContext';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const requestIdFormat = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId) {
    info.requestId = requestId;
  }
  return info;
});

const devFormat = combine(
  requestIdFormat(),
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, requestId }) => {
    const requestIdPart = requestId ? ` [${requestId}]` : '';
    return `${ts} [${level}]${requestIdPart} ${stack || message}`;
  }),
);

const prodFormat = combine(requestIdFormat(), timestamp(), errors({ stack: true }), json());

export const logger = winston.createLogger({
  level: env.logLevel,
  format: env.isProduction ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
});
