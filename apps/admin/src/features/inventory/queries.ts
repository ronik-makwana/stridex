import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { InventoryListQuery, TransactionListQuery } from '@/types/api'
import { inventoryApi } from './api'

export const inventoryKeys = {
  all: ['inventory'] as const,
  lists: () => [...inventoryKeys.all, 'list'] as const,
  list: (query: InventoryListQuery) => [...inventoryKeys.lists(), query] as const,
  lowStock: (query: InventoryListQuery) => [...inventoryKeys.all, 'low-stock', query] as const,
  detail: (variantId: string) => [...inventoryKeys.all, 'detail', variantId] as const,
  ledgers: () => [...inventoryKeys.all, 'ledger'] as const,
  ledger: (query: TransactionListQuery) => [...inventoryKeys.ledgers(), query] as const,
  variantLedger: (variantId: string, query: TransactionListQuery) =>
    [...inventoryKeys.ledgers(), variantId, query] as const,
  reasons: () => [...inventoryKeys.all, 'reasons'] as const,
}

export function useInventory(query: InventoryListQuery) {
  return useQuery({
    queryKey: inventoryKeys.list(query),
    queryFn: () => inventoryApi.list(query),
    placeholderData: keepPreviousData,
  })
}

export function useLowStock(query: InventoryListQuery) {
  return useQuery({
    queryKey: inventoryKeys.lowStock(query),
    queryFn: () => inventoryApi.lowStock(query),
    placeholderData: keepPreviousData,
  })
}

export function useInventoryRow(variantId: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.detail(variantId!),
    queryFn: () => inventoryApi.get(variantId!),
    enabled: Boolean(variantId),
  })
}

export function useInventoryLedger(query: TransactionListQuery) {
  return useQuery({
    queryKey: inventoryKeys.ledger(query),
    queryFn: () => inventoryApi.transactions(query),
    placeholderData: keepPreviousData,
  })
}

export function useVariantLedger(variantId: string | undefined, query: TransactionListQuery) {
  return useQuery({
    queryKey: inventoryKeys.variantLedger(variantId!, query),
    queryFn: () => inventoryApi.variantTransactions(variantId!, query),
    enabled: Boolean(variantId),
    placeholderData: keepPreviousData,
  })
}

/** The reason list changes only when the API does, so it is cached hard. */
export function useAdjustReasons() {
  return useQuery({
    queryKey: inventoryKeys.reasons(),
    queryFn: () => inventoryApi.reasons(),
    staleTime: 60 * 60_000,
  })
}
