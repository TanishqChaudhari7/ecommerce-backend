import { z } from 'zod';

export const initiatePaymentSchema = z.object({
  orderId: z.string().uuid(),
  paymentKey: z.string().min(1),
});

export const paymentIdParamSchema = z.object({
  paymentId: z.string().uuid(),
});

export type InitiatePaymentBody = z.infer<typeof initiatePaymentSchema>;
