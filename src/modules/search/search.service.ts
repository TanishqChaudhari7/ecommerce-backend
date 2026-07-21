import crypto from 'crypto';
import { pool } from '../../config/db';
import { redis } from '../../config/redis';
import { PRODUCT_SELECT, toPublicProduct } from '../products/products.query';
import { ProductRow } from '../products/products.types';
import { SearchQuery } from './search.validation';
import { SearchResult } from './search.types';

const SEARCH_CACHE_TTL_SECONDS = 300;

const SORT_COLUMNS: Record<SearchQuery['sortBy'], string> = {
  price: 'p.price',
  created_at: 'p.created_at',
};

function buildCacheKey(query: SearchQuery): string {
  const canonical = JSON.stringify(query, Object.keys(query).sort());
  const hash = crypto.createHash('md5').update(canonical).digest('hex');
  return `search:${hash}`;
}

function buildWhereClause(query: SearchQuery): { whereClause: string; params: unknown[] } {
  const conditions: string[] = ['p.is_deleted = false'];
  const params: unknown[] = [];

  if (query.q) {
    params.push(query.q);
    conditions.push(`p.search_vector @@ plainto_tsquery('english', $${params.length})`);
  }
  if (query.category) {
    params.push(query.category);
    conditions.push(`c.slug = $${params.length}`);
  }
  if (query.minPrice !== undefined) {
    params.push(query.minPrice);
    conditions.push(`p.price >= $${params.length}`);
  }
  if (query.maxPrice !== undefined) {
    params.push(query.maxPrice);
    conditions.push(`p.price <= $${params.length}`);
  }
  if (query.brand) {
    params.push(query.brand);
    conditions.push(`p.brand ILIKE $${params.length}`);
  }

  return { whereClause: conditions.join(' AND '), params };
}

export class SearchService {
  async search(query: SearchQuery): Promise<SearchResult> {
    const cacheKey = buildCacheKey(query);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SearchResult;
    }

    const { whereClause, params } = buildWhereClause(query);

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${whereClause}`,
      params,
    );
    const total = Number(countResult.rows[0].count);

    const offset = (query.page - 1) * query.limit;
    const sortColumn = SORT_COLUMNS[query.sortBy];
    const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const dataParams = [...params, query.limit, offset];

    const result = await pool.query<ProductRow>(
      `${PRODUCT_SELECT} WHERE ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );

    const searchResult: SearchResult = {
      products: result.rows.map(toPublicProduct),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };

    await redis.set(cacheKey, JSON.stringify(searchResult), 'EX', SEARCH_CACHE_TTL_SECONDS);
    return searchResult;
  }
}

export const searchService = new SearchService();
