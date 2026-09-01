import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-client'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Longer than admin's 30s. A catalog is not a dashboard: a price or a
      // stock bucket that is a minute stale is fine on a grid, and the numbers
      // that must be exact — every total in checkout — are re-read from the
      // server at the moment they matter (§21), never from this cache.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        // 4xx is a wrong request, not a flaky network. Retrying it burns rate
        // limit and delays the error the customer needs to see. A 404 from a
        // deleted product must render the not-found page immediately.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 2
      },
    },
    mutations: { retry: false },
  },
})
