export class PaymentsService {
  async ping(): Promise<{ module: string }> {
    return { module: 'payments' };
  }
}

export const paymentsService = new PaymentsService();
