import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { catalogApi, type CatalogParams } from './api'

export const catalogKeys = {
  product: (slug: string) => ['product', slug] as const,
  related: (slug: string) => ['product', slug, 'related'] as const,
}

export function useProduct(slug: string) {
  return useQuery({
    queryKey: catalogKeys.product(slug),
    queryFn: () => catalogApi.product(slug),
    // A 404 must render the not-found page immediately; the shared query client
    // already refuses to retry 4xx.
    enabled: Boolean(slug),
  })
}

/**
 * A separate query from the product, matching the API split. It is below the
 * fold, so it must never make the buy box wait — and a failure here should cost
 * the customer a carousel, not the page.
 */
export function useRelatedProducts(slug: string) {
  return useQuery({
    queryKey: catalogKeys.related(slug),
    queryFn: () => catalogApi.related(slug),
    enabled: Boolean(slug),
    staleTime: 5 * 60_000,
  })
}

// ─── browsing ────────────────────────────────────────────────────────────────

export const browseKeys = {
  tree: ['categories', 'tree'] as const,
  category: (slug: string) => ['category', slug] as const,
  products: (params: CatalogParams) => ['products', params] as const,
  facets: (params: CatalogParams) => ['facets', params] as const,
  collections: ['collections'] as const,
  collection: (slug: string) => ['collection', slug] as const,
  suggest: (q: string) => ['suggest', q] as const,
}

/** The nav. Rarely changes, so it is cached hard and shared by every page. */
export function useCategoryTree() {
  return useQuery({
    queryKey: browseKeys.tree,
    queryFn: catalogApi.categoryTree,
    staleTime: 10 * 60_000,
  })
}

export function useCategory(slug: string) {
  return useQuery({
    queryKey: browseKeys.category(slug),
    queryFn: () => catalogApi.category(slug),
    enabled: Boolean(slug),
  })
}

export function useProducts(params: CatalogParams) {
  return useQuery({
    queryKey: browseKeys.products(params),
    queryFn: () => catalogApi.products(params),
    // The previous page stays on screen while the next one loads, so ticking a
    // filter dims the grid instead of collapsing the page to a skeleton and
    // throwing the customer's scroll position away.
    placeholderData: keepPreviousData,
  })
}

/**
 * A separate query from the grid, matching the API split — facets must never
 * hold up the products themselves.
 */
export function useFacets(params: CatalogParams) {
  return useQuery({
    queryKey: browseKeys.facets(params),
    queryFn: () => catalogApi.facets(params),
    placeholderData: keepPreviousData,
  })
}

export function useCollections() {
  return useQuery({ queryKey: browseKeys.collections, queryFn: catalogApi.collections })
}

export function useCollection(slug: string) {
  return useQuery({
    queryKey: browseKeys.collection(slug),
    queryFn: () => catalogApi.collection(slug),
    enabled: Boolean(slug),
  })
}

/** The header overlay. Fires per keystroke, so the caller debounces it. */
export function useSuggest(q: string) {
  return useQuery({
    queryKey: browseKeys.suggest(q),
    queryFn: () => catalogApi.suggest(q),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  })
}
