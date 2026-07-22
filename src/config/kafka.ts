import { Kafka, Partitioners, Producer } from 'kafkajs';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { kafkaEventsPublishedTotal } from './metrics';

export const KAFKA_TOPICS = {
  PRODUCT_UPDATED: 'product.updated',
  INVENTORY_UPDATED: 'inventory.updated',
  ORDER_CREATED: 'order.created',
  ORDER_CANCELLED: 'order.cancelled',
  PAYMENT_COMPLETED: 'payment.completed',
} as const;

export const kafka = new Kafka({
  clientId: env.kafkaClientId,
  brokers: env.kafkaBrokers,
  // kafkajs's defaults (5 retries, backoff up to 30s each) mean a single
  // connection attempt against an unreachable broker can block for minutes.
  // Since publishEvent is designed to be best-effort (catch and log, never
  // block the request that triggered it), a slow failure defeats that intent
  // just as badly as a hang would - fail fast instead.
  connectionTimeout: 2000,
  retry: {
    retries: 1,
    initialRetryTime: 300,
    maxRetryTime: 1000,
  },
});

export const producer: Producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

let connected = false;

async function ensureConnected(): Promise<void> {
  if (!connected) {
    await producer.connect();
    connected = true;
  }
}

export async function publishEvent<T>(topic: string, payload: T): Promise<void> {
  try {
    await ensureConnected();
    await producer.send({
      topic,
      messages: [{ value: JSON.stringify(payload) }],
    });
    kafkaEventsPublishedTotal.inc({ topic });
  } catch (error) {
    logger.error('Failed to publish Kafka event', { topic, error });
  }
}

export async function disconnectProducer(): Promise<void> {
  if (connected) {
    await producer.disconnect();
    connected = false;
  }
}
