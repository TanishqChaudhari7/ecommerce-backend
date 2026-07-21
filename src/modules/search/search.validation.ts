import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  category: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  brand: z.string().optional(),
  sortBy: z.enum(['price', 'created_at']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
