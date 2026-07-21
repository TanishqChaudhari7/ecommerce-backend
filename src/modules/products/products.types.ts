export interface ProductRow {
  id: string;
  seller_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: string;
  sku: string;
  brand: string | null;
  is_available: boolean;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
  category_name: string | null;
  seller_first_name: string;
  seller_last_name: string;
  seller_email: string;
  total_stock: number;
  reserved_stock: number;
  low_stock_threshold: number;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  sku: string;
  brand: string | null;
  isAvailable: boolean;
  availableStock: number;
  category: {
    id: string | null;
    name: string | null;
  };
  seller: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateProductInput {
  name: string;
  description?: string;
  price: number;
  sku: string;
  brand?: string;
  categoryId?: string;
  isAvailable: boolean;
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  price?: number;
  brand?: string;
  categoryId?: string | null;
  isAvailable?: boolean;
}
