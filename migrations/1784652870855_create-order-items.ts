import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('order_items', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    order_id: {
      type: 'uuid',
      notNull: true,
      references: 'orders',
      onDelete: 'CASCADE',
    },
    product_id: {
      type: 'uuid',
      notNull: true,
      references: 'products',
      onDelete: 'RESTRICT',
    },
    quantity: { type: 'integer', notNull: true, check: 'quantity > 0' },
    unit_price: { type: 'numeric(10,2)', notNull: true, check: 'unit_price >= 0' },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('order_items');
}
