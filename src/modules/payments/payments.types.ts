export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export interface PublicPayment {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  status: PaymentStatus;
  paymentKey: string;
  createdAt: string;
}
