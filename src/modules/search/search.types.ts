import { Pagination, PublicProduct } from '../products/products.types';

export interface SearchResult {
  products: PublicProduct[];
  pagination: Pagination;
}
