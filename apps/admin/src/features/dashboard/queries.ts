import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from './api'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  card: (name: string, range: unknown) => [...dashboardKeys.all, name, range] as const,
  search: (q: string) => ['admin-search', q] as const,
}

type Range = { from?: string; to?: string }

export const useSummary = (range: Range) =>
  useQuery({ queryKey: dashboardKeys.card('summary', range), queryFn: () => dashboardApi.summary(range) })

export const useSales = (range: Range & { interval?: 'day' | 'week' }) =>
  useQuery({ queryKey: dashboardKeys.card('sales', range), queryFn: () => dashboardApi.sales(range) })

export const useRecentOrders = () =>
  useQuery({ queryKey: dashboardKeys.card('orders', null), queryFn: () => dashboardApi.recentOrders() })

export const useLowStock = () =>
  useQuery({ queryKey: dashboardKeys.card('inventory', null), queryFn: () => dashboardApi.lowStock() })

export const useTopProducts = (range: Range) =>
  useQuery({ queryKey: dashboardKeys.card('top', range), queryFn: () => dashboardApi.topProducts(range) })

export const useAttention = () =>
  useQuery({ queryKey: dashboardKeys.card('attention', null), queryFn: () => dashboardApi.attention() })

/** ⌘K. Only fires past two characters — the server refuses anything shorter. */
export function useAdminSearch(q: string) {
  return useQuery({
    queryKey: dashboardKeys.search(q),
    queryFn: () => dashboardApi.search(q),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  })
}
