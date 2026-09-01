import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { addressesApi } from './api'

export const addressKeys = {
  all: ['addresses'] as const,
  list: () => [...addressKeys.all, 'list'] as const,
}

/**
 * The whole book in one request — a customer has three of these, not three
 * hundred, so there is no pagination and no per-address fetch.
 *
 * Disabled for a guest rather than left to 401: checkout will call this from a
 * page a signed-out customer can briefly see while the session is restoring.
 */
export function useAddresses() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: addressKeys.list(),
    queryFn: () => addressesApi.list(),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  })
}
