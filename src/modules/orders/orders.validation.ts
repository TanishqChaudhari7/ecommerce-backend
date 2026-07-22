import { z } from 'zod';

export const orderIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['confirmed', 'shipped', 'delivered']),
});

export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusSchema>;
