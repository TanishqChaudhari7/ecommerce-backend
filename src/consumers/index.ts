import { Consumer, EachMessagePayload } from 'kafkajs';
import { kafka, KAFKA_TOPICS } from '../config/kafka';
import { pool } from '../config/db';
import { redis, invalidateProductCaches } from '../config/redis';
import { logger } from '../../config/logger';

const ALL_TOPICS = Object.values(KAFKA_TOPICS);
const STOCK_RELEASE_TTL_SECONDS = 60 * 60 * 24 * 7;

interface OrderCancelledEvent {
  orderId: string;
  userId: string;
  items: { productId: string; quantity: number }[];
}

async function handleAuditMessage({ topic, message }: EachMessagePayload): Promise<void> {
  const payload = message.value?.toString() ?? '';
  logger.info(`[AUDIT] ${new Date().toISOString()} | topic: ${topic} | payload: ${payload}`);
}

async function startAuditConsumer(): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId: 'audit-consumer' });
  await consumer.connect();
  await Promise.all(ALL_TOPICS.map((topic) => consumer.subscribe({ topic, fromBeginning: false })));
  await consumer.run({ eachMessage: handleAuditMessage });
  return consumer;
}

async function handleOrderCancelled({ message }: EachMessagePayload): Promise<void> {
  const raw = message.value?.toString();
  if (!raw) {
    return;
  }

  let event: OrderCancelledEvent;
  try {
    event = JSON.parse(raw) as OrderCancelledEvent;
  } catch (error) {
    logger.error('InventoryConsumer failed to parse order.cancelled message', { error });
    return;
  }

  const releaseKey = `order:stock-released:${event.orderId}`;
  const claimed = await redis.set(releaseKey, '1', 'EX', STOCK_RELEASE_TTL_SECONDS, 'NX');
  if (claimed !== 'OK') {
    logger.info(`Reserved stock already released for order ${event.orderId}, skipping`);
    return;
  }

  for (const item of event.items) {
    try {
      await pool.query(
        'UPDATE inventory SET reserved_stock = GREATEST(reserved_stock - $1, 0) WHERE product_id = $2',
        [item.quantity, item.productId],
      );
    } catch (error) {
      logger.error('InventoryConsumer failed to release reserved stock', {
        orderId: event.orderId,
        productId: item.productId,
        error,
      });
    }
  }

  await invalidateProductCaches(event.items.map((item) => item.productId));
}

async function startInventoryConsumer(): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId: 'inventory-consumer' });
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.ORDER_CANCELLED, fromBeginning: false });
  await consumer.run({ eachMessage: handleOrderCancelled });
  return consumer;
}

export async function startConsumers(): Promise<Consumer[]> {
  const consumers = await Promise.all([startAuditConsumer(), startInventoryConsumer()]);
  logger.info('Kafka consumers started (audit, inventory)');
  return consumers;
}
