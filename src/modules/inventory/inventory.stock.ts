import { PoolClient } from 'pg';

/**
 * Gives an order's reserved stock back ('release', on cancel or refund) or turns it
 * into a permanent stock reduction ('consume', on delivery), inside the caller's
 * transaction. Returns the affected product ids so the caller can invalidate caches.
 *
 * The inventory rows are locked in product_id order - the same global order
 * placeOrder uses - so these writes can never deadlock against a concurrent checkout
 * touching the same products.
 */
export async function adjustOrderStock(
  client: PoolClient,
  orderId: string,
  mode: 'release' | 'consume',
): Promise<string[]> {
  const itemsResult = await client.query<{ product_id: string; quantity: number }>(
    `SELECT oi.product_id, oi.quantity
     FROM order_items oi
     JOIN inventory i ON i.product_id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.product_id
     FOR UPDATE OF i`,
    [orderId],
  );
  const items = itemsResult.rows;
  if (items.length === 0) {
    return [];
  }

  const totalStockClause = mode === 'consume' ? ', total_stock = i.total_stock - u.quantity' : '';
  await client.query(
    `UPDATE inventory i
     SET reserved_stock = i.reserved_stock - u.quantity${totalStockClause}
     FROM unnest($1::uuid[], $2::int[]) AS u(product_id, quantity)
     WHERE i.product_id = u.product_id`,
    [items.map((item) => item.product_id), items.map((item) => item.quantity)],
  );

  return items.map((item) => item.product_id);
}
