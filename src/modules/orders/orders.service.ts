export class OrdersService {
  async ping(): Promise<{ module: string }> {
    return { module: 'orders' };
  }
}

export const ordersService = new OrdersService();
