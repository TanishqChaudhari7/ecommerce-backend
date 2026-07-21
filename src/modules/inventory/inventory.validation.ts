import { z } from 'zod';

export const productIdParamSchema = z.object({
  productId: z.string().uuid(),
});

export const updateInventorySchema = z.object({
  totalStock: z.number().int().min(0),
});

export type UpdateInventoryBody = z.infer<typeof updateInventorySchema>;
