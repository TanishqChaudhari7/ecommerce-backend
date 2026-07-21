import { z } from 'zod';

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const productIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  sku: z.string().min(1),
  brand: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  isAvailable: z.boolean().optional().default(true),
});

export const updateProductSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    price: z.number().positive().optional(),
    brand: z.string().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    isAvailable: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateProductBody = z.infer<typeof createProductSchema>;
export type UpdateProductBody = z.infer<typeof updateProductSchema>;
