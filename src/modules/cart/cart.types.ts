export interface CartItemDetail {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  subtotal: number;
  availableStock: number;
}

export interface CartDetail {
  id: string;
  items: CartItemDetail[];
  total: number;
}
