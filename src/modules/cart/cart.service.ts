export class CartService {
  async ping(): Promise<{ module: string }> {
    return { module: 'cart' };
  }
}

export const cartService = new CartService();
