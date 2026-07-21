export class InventoryService {
  async ping(): Promise<{ module: string }> {
    return { module: 'inventory' };
  }
}

export const inventoryService = new InventoryService();
