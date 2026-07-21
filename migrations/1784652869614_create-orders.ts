import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType('order_status', ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']);

  pgm.createTable('orders', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    status: { type: 'order_status', notNull: true, default: 'pending' },
    total_amount: { type: 'numeric(10,2)', notNull: true, check: 'total_amount >= 0' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('orders', 'user_id');
  pgm.createIndex('orders', 'status');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('orders');
  pgm.dropType('order_status');
}
