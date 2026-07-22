import { Kafka, Partitioners, Producer } from 'kafkajs';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

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
