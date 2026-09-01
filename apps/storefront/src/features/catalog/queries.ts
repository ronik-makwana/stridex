import { useQuery } from '@tanstack/react-query'
import { catalogApi } from './api'

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
