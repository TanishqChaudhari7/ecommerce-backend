export class ProductsService {
  async ping(): Promise<{ module: string }> {
    return { module: 'products' };
  }
}

export const productsService = new ProductsService();
