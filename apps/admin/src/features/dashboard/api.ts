import { get } from '@/lib/api-client'
import type {
  AttentionLine,
  DashboardSummary,
  LowStockRow,
  RecentOrder,
  SalesPoint,
  SearchResults,
  TopProduct,
} from '@/types/api'

type Range = { from?: string; to?: string }

/**
 * Six calls rather than one, so each card can render as its own answer arrives.
 * A single endpoint would make the page as slow as its slowest query.
 */
export const dashboardApi = {
  summary: (range: Range) => get<DashboardSummary>('/dashboard/summary', { params: range }),
  sales: (range: Range & { interval?: 'day' | 'week' }) =>
    get<SalesPoint[]>('/dashboard/sales', { params: range }),
  recentOrders: () => get<RecentOrder[]>('/dashboard/orders'),
  lowStock: () => get<LowStockRow[]>('/dashboard/inventory'),
  topProducts: (range: Range) => get<TopProduct[]>('/dashboard/top-products', { params: range }),
  attention: () => get<AttentionLine[]>('/dashboard/attention'),
  search: (q: string) => get<SearchResults>('/search', { params: { q } }),
}
