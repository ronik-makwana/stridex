import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Collection, EntityStatus } from '@/types/api'
import { collectionsApi } from './api'
import { collectionKeys } from './queries'
import type { CollectionValues } from './schemas'

/**
 * A dynamic collection's membership is a query result, not a stored list — so
 * any write invalidates the whole subtree rather than trying to reason about
 * which counts could still be right.
 */
function useWriteDetail() {
  const queryClient = useQueryClient()
  return (collection: Collection) => {
    queryClient.setQueryData(collectionKeys.detail(collection.id), collection)
    void queryClient.invalidateQueries({ queryKey: collectionKeys.lists() })
  }
}

export function useCreateCollection() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: (values: CollectionValues) => collectionsApi.create(values),
    onSuccess: (collection) => {
      writeDetail(collection)
      toast.success(`${collection.name} created`)
    },
  })
}

export function useUpdateCollection() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<CollectionValues> }) =>
      collectionsApi.update(id, values),
    onSuccess: (collection) => {
      writeDetail(collection)
      toast.success('Saved')
    },
  })
}

export function useSetCollectionStatus() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EntityStatus }) =>
      collectionsApi.setStatus(id, status),
    onSuccess: writeDetail,
  })
}

export function useDeleteCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => collectionsApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: collectionKeys.all }),
  })
}

// ─── manual membership ───────────────────────────────────────────────────────

function useInvalidateMembership(collectionId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: collectionKeys.all })
    void queryClient.invalidateQueries({ queryKey: collectionKeys.detail(collectionId) })
  }
}

export function useAddCollectionProducts(collectionId: string) {
  const invalidate = useInvalidateMembership(collectionId)
  return useMutation({
    mutationFn: (productIds: string[]) => collectionsApi.addProducts(collectionId, productIds),
    onSuccess: ({ added }, productIds) => {
      invalidate()
      // Says what actually landed. Adding six of which two were already in is a
      // success, and reporting six would be a lie the operator can see through.
      const skipped = productIds.length - added
      toast.success(
        skipped > 0
          ? `${added} added, ${skipped} already in this collection`
          : `${added} ${added === 1 ? 'product' : 'products'} added`,
      )
    },
  })
}

export function useRemoveCollectionProduct(collectionId: string) {
  const invalidate = useInvalidateMembership(collectionId)
  return useMutation({
    mutationFn: (productId: string) => collectionsApi.removeProduct(collectionId, productId),
    onSuccess: () => invalidate(),
  })
}

export function useReorderCollectionProducts(collectionId: string) {
  const invalidate = useInvalidateMembership(collectionId)
  return useMutation({
    mutationFn: (ids: string[]) => collectionsApi.reorderProducts(collectionId, ids),
    // 204, so there is nothing to write into the cache — the optimistic order
    // in the panel is already correct and a refetch confirms it.
    onSuccess: () => invalidate(),
  })
}
