import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('cart_items', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    cart_id: {
      type: 'uuid',
      notNull: true,
      references: 'shopping_carts',
      onDelete: 'CASCADE',
    },
    product_id: {
      type: 'uuid',
      notNull: true,
      references: 'products',
      onDelete: 'CASCADE',
    },
    quantity: { type: 'integer', notNull: true, check: 'quantity > 0' },
  });

  pgm.addConstraint('cart_items', 'cart_items_cart_id_product_id_key', {
    unique: ['cart_id', 'product_id'],
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('cart_items');
}
