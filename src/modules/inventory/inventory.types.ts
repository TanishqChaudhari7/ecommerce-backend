export interface InventoryStatus {
  productId: string;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  lowStockThreshold: number;
}

export interface LowStockProduct {
  productId: string;
  name: string;
  sku: string;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  lowStockThreshold: number;
}
