import { get } from '@/lib/api-client'
import type { Product, ProductCard } from '@/types/api'

export const catalogApi = {
  product: (slug: string) => get<Product>(`/products/${encodeURIComponent(slug)}`),
  related: (slug: string) => get<ProductCard[]>(`/products/${encodeURIComponent(slug)}/related`),
}
