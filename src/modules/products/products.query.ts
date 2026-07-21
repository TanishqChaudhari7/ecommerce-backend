import { ProductRow, PublicProduct } from './products.types';

export const PRODUCT_SELECT = `
  SELECT
    p.id, p.seller_id, p.category_id, p.name, p.description, p.price, p.sku, p.brand,
    p.is_available, p.is_deleted, p.created_at, p.updated_at,
    c.name AS category_name,
    u.first_name AS seller_first_name, u.last_name AS seller_last_name, u.email AS seller_email,
    COALESCE(i.total_stock, 0) AS total_stock,
    COALESCE(i.reserved_stock, 0) AS reserved_stock,
    COALESCE(i.low_stock_threshold, 0) AS low_stock_threshold
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  JOIN users u ON u.id = p.seller_id
  LEFT JOIN inventory i ON i.product_id = p.id
`;

export function toPublicProduct(row: ProductRow): PublicProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    sku: row.sku,
    brand: row.brand,
    isAvailable: row.is_available,
    availableStock: row.total_stock - row.reserved_stock,
    category: {
      id: row.category_id,
      name: row.category_name,
    },
    seller: {
      id: row.seller_id,
      firstName: row.seller_first_name,
      lastName: row.seller_last_name,
      email: row.seller_email,
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
