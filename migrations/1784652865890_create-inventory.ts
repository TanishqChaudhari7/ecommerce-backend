import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('inventory', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    product_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      references: 'products',
      onDelete: 'CASCADE',
    },
    total_stock: { type: 'integer', notNull: true, default: 0, check: 'total_stock >= 0' },
    reserved_stock: {
      type: 'integer',
      notNull: true,
      default: 0,
      check: 'reserved_stock >= 0 AND reserved_stock <= total_stock',
    },
    low_stock_threshold: { type: 'integer', notNull: true, default: 10 },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('inventory');
}
