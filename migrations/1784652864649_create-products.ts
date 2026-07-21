import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('products', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    seller_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    category_id: {
      type: 'uuid',
      references: 'categories',
      onDelete: 'SET NULL',
    },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    price: { type: 'numeric(10,2)', notNull: true, check: 'price >= 0' },
    sku: { type: 'text', notNull: true, unique: true },
    brand: { type: 'text' },
    is_available: { type: 'boolean', notNull: true, default: true },
    is_deleted: { type: 'boolean', notNull: true, default: false },
    search_vector: { type: 'tsvector' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('products', 'seller_id');
  pgm.createIndex('products', 'category_id');
  pgm.createIndex('products', 'search_vector', { method: 'gin' });

  pgm.createFunction(
    'products_search_vector_update',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `
    BEGIN
      NEW.search_vector := to_tsvector('english',
        coalesce(NEW.name, '') || ' ' ||
        coalesce(NEW.brand, '') || ' ' ||
        coalesce(NEW.description, '')
      );
      RETURN NEW;
    END;
    `,
  );

  pgm.createTrigger('products', 'products_search_vector_trigger', {
    when: 'BEFORE',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'products_search_vector_update',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTrigger('products', 'products_search_vector_trigger');
  pgm.dropFunction('products_search_vector_update', []);
  pgm.dropTable('products');
}
