import { api, get } from '@/lib/api-client'
import type {
  CategoryDetail,
  CategoryNode,
  Collection,
  FacetsResponse,
  Product,
  ProductCard,
  ProductListResponse,
  Suggestion,
} from '@/types/api'

/**
 * `params` is a plain record rather than a typed object because attribute
 * filters are keyed by attribute id — `attr:<uuid>` — and those keys are data,
 * not a fixed shape any interface could name.
 */
export type CatalogParams = Record<string, string | number | undefined>

export const catalogApi = {
  product: (slug: string) => get<Product>(`/products/${encodeURIComponent(slug)}`),
  related: (slug: string) => get<ProductCard[]>(`/products/${encodeURIComponent(slug)}/related`),

  categoryTree: () => get<CategoryNode[]>('/categories/tree'),
  category: (slug: string) => get<CategoryDetail>(`/categories/${encodeURIComponent(slug)}`),

  /** The grid. Serves the category page, collections and search alike. */
  products: async (params: CatalogParams) => {
    const res = await api.get<ProductListResponse>('/products', { params })
    return res.data
  },

  /** Counts for the same filter the grid just used. */
  facets: (params: CatalogParams) => get<FacetsResponse>('/products/facets', { params }),

  collections: () => get<Collection[]>('/collections'),
  collection: (slug: string) => get<Collection>(`/collections/${encodeURIComponent(slug)}`),

  suggest: (q: string) => get<Suggestion>('/search/suggest', { params: { q } }),
}
