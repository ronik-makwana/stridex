import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { productKeys } from '@/features/products/queries'
import type { AdjustStockInput, RestockInput } from '@/types/api'
import { inventoryApi } from './api'
import { inventoryKeys } from './queries'

/**
 * A stock write moves a row between stock buckets, changes the ledger, and
 * changes what the product list reports as total stock — so both trees are
 * invalidated. Cheaper than trying to work out which pages could still be
 * right, and this is not a hot path.
 */
function useInvalidateStock() {
  const queryClient = useQueryClient()
  return (variantId: string) => {
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
    void queryClient.invalidateQueries({ queryKey: productKeys.all })
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.detail(variantId) })
  }
}

export function useAdjustStock() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: ({ variantId, values }: { variantId: string; values: AdjustStockInput }) =>
      inventoryApi.adjust(variantId, values),
    onSuccess: (row) => {
      invalidate(row.variantId)
      toast.success(`${row.sku} is now ${row.quantity} on hand`)
    },
    // No error toast: the dialog keeps the failure next to the number that
    // caused it, which a toast would talk over.
  })
}

export function useRestock() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: ({ variantId, values }: { variantId: string; values: RestockInput }) =>
      inventoryApi.restock(variantId, values),
    onSuccess: (row) => {
      invalidate(row.variantId)
      toast.success(`${row.sku} is now ${row.quantity} on hand`)
    },
  })
}

export function useSetThreshold() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: ({ variantId, threshold }: { variantId: string; threshold: number }) =>
      inventoryApi.setThreshold(variantId, threshold),
    onSuccess: (row) => {
      invalidate(row.variantId)
      toast.success(`${row.sku} is low below ${row.lowStockThreshold}`)
    },
  })
}
