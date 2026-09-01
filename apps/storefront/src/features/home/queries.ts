import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api-client'
import type { HomePayload } from '@/types/api'

/**
 * One request for the whole page. The home page is above the fold in its
 * entirety, and five calls would paint it in five stages with the last still
 * moving as somebody started reading.
 */
export function useHome() {
  return useQuery({
    queryKey: ['home'],
    queryFn: () => get<HomePayload>('/home'),
    // Merchandising changes on a merchandiser's timescale, not a shopper's.
    staleTime: 5 * 60_000,
  })
}
