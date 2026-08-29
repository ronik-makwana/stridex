import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { EntityStatus, Product, ProductMedia, ProductVariant } from '@/types/api'
import { productsApi, putToPresignedUrl } from './api'
import { productKeys } from './queries'
import type { BulkVariantValues, GenerateValues, ProductValues, VariantValues } from './schemas'

/**
 * Every list key holds a different page or filter, so invalidating the whole
 * `products` subtree is the only correct move after a write: a rename can move
 * a row between pages, a publish moves it between status filters, and a stock
 * edit changes which stock bucket it lands in.
 */
function useInvalidateProducts() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: productKeys.all })
}

/**
 * The detail endpoint is the authority on the whole editor, so a write that
 * answers with the product writes it straight into the cache. Without this the
 * media panel blanks and the variant grid re-mounts on every save, losing
 * whatever cell had focus.
 */
function useWriteDetail() {
  const queryClient = useQueryClient()
  return (product: Product) => {
    queryClient.setQueryData(productKeys.detail(product.id), product)
    void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
    void queryClient.invalidateQueries({ queryKey: productKeys.checklist(product.id) })
  }
}

export function useCreateProduct() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: (values: ProductValues) => productsApi.create(values),
    onSuccess: (product) => {
      writeDetail(product)
      toast.success(`${product.title} created`)
    },
  })
}

export function useUpdateProduct() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ProductValues> }) =>
      productsApi.update(id, values),
    onSuccess: (product) => {
      writeDetail(product)
      toast.success('Saved')
    },
  })
}

export function useSetProductStatus() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EntityStatus }) =>
      productsApi.setStatus(id, status),
    onSuccess: writeDetail,
  })
}

export function usePublishProduct() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: (id: string) => productsApi.publish(id),
    onSuccess: (product) => {
      writeDetail(product)
      toast.success(`${product.title} is live`)
    },
    // No error toast: a failed publish is a 422 carrying the checklist, and the
    // popover is a better place to read it than a toast that talks over it.
  })
}

export function useArchiveProduct() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: (id: string) => productsApi.archive(id),
    onSuccess: (product) => {
      writeDetail(product)
      toast.success(`${product.title} archived`)
    },
  })
}

export function useDuplicateProduct() {
  const writeDetail = useWriteDetail()
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string
      values: { title: string; includeMedia: boolean; includeVariants: boolean; includeInventory: boolean }
    }) => productsApi.duplicate(id, values),
    onSuccess: writeDetail,
  })
}

export function useDeleteProduct() {
  const invalidate = useInvalidateProducts()
  return useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => void invalidate(),
    // No toast here: a blocked delete is a 422 the dialog turns into an
    // explanation with a way forward, which a toast would talk over.
  })
}

export function useBulkProducts() {
  const invalidate = useInvalidateProducts()
  return useMutation({
    mutationFn: (values: { ids: string[]; action: string; categoryId?: string | null }) =>
      productsApi.bulk(values),
    onSuccess: () => void invalidate(),
  })
}

// ─── media ───────────────────────────────────────────────────────────────────

/**
 * Presign, PUT, record — one hook, because the three steps are only ever useful
 * together and a caller that forgets the third leaves an object nothing points
 * at.
 */
export function useUploadMedia(productId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File
      onProgress?: (percent: number) => void
    }) => {
      const upload = await productsApi.presignMedia(productId, {
        filename: file.name,
        contentType: file.type,
      })
      await putToPresignedUrl(upload.uploadUrl, file, onProgress)
      return productsApi.recordMedia(productId, { key: upload.key })
    },
    onSuccess: () => {
      // The gallery lives on the product detail payload, so the product is what
      // gets refetched — not a separate media list that could disagree with it.
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) })
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: productKeys.checklist(productId) })
    },
  })
}

export function useUpdateMedia(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ mediaId, altText }: { mediaId: string; altText: string | null }) =>
      productsApi.updateMedia(productId, mediaId, { altText }),
    onSuccess: (media) => {
      queryClient.setQueryData<Product>(productKeys.detail(productId), (current) =>
        current
          ? { ...current, media: (current.media ?? []).map((row) => (row.id === media.id ? media : row)) }
          : current,
      )
    },
  })
}

export function useDeleteMedia(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mediaId: string) => productsApi.removeMedia(productId, mediaId),
    onSuccess: () => {
      // Deleting closes the gap in sort order and can promote a new cover, so
      // the server's answer is the one that counts.
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) })
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: productKeys.checklist(productId) })
    },
  })
}

export function useReorderMedia(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => productsApi.reorderMedia(productId, ids),
    onSuccess: (media: ProductMedia[]) => {
      // The response is the settled order. Writing it straight into the cache
      // keeps the gallery still — an invalidate would refetch and re-animate a
      // grid the operator just finished dragging.
      queryClient.setQueryData<Product>(productKeys.detail(productId), (current) =>
        current ? { ...current, media, coverUrl: media[0]?.url ?? null } : current,
      )
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
    },
  })
}

// ─── variants ────────────────────────────────────────────────────────────────

function useWriteVariants(productId: string) {
  const queryClient = useQueryClient()
  return (variants: ProductVariant[]) => {
    queryClient.setQueryData<Product>(productKeys.detail(productId), (current) =>
      current ? { ...current, variants, variantCount: variants.length } : current,
    )
    void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
    void queryClient.invalidateQueries({ queryKey: productKeys.checklist(productId) })
  }
}

export function useCreateVariant(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: VariantValues) => productsApi.createVariant(productId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) })
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: productKeys.checklist(productId) })
    },
  })
}

export function useUpdateVariant(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ variantId, values }: { variantId: string; values: Partial<VariantValues> }) =>
      productsApi.updateVariant(productId, variantId, values),
    onSuccess: (variant) => {
      queryClient.setQueryData<Product>(productKeys.detail(productId), (current) =>
        current
          ? {
              ...current,
              variants: (current.variants ?? []).map((row) =>
                row.id === variant.id ? variant : row,
              ),
            }
          : current,
      )
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
    },
  })
}

export function useDeleteVariant(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variantId: string) => productsApi.removeVariant(productId, variantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) })
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
    },
  })
}

/** The spreadsheet save. Answers with the whole settled grid. */
export function useBulkVariants(productId: string) {
  const writeVariants = useWriteVariants(productId)
  return useMutation({
    mutationFn: (values: BulkVariantValues) => productsApi.bulkVariants(productId, values),
    onSuccess: (variants) => {
      writeVariants(variants)
      toast.success('Variants saved')
    },
  })
}

/**
 * Both halves of generate go through here. A dry run touches no cache — it has
 * changed nothing — while a commit refetches the product, because the grid it
 * just rewrote is the product's own payload.
 */
export function useGenerateVariants(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: GenerateValues) => productsApi.generateVariants(productId, values),
    onSuccess: (result) => {
      if (!result.applied) return
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) })
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: productKeys.checklist(productId) })
    },
  })
}
