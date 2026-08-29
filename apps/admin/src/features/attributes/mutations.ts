import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Attribute, AttributeValue } from '@/types/api'
import { attributesApi } from './api'
import { attributeKeys } from './queries'
import type { AttributeValues, AttributeValueValues } from './schemas'

/**
 * Every list key holds a different page or filter, so invalidating the whole
 * `attributes` subtree is the only correct move after a write: a rename can
 * move a row between pages, and a value change moves the values count.
 */
function useInvalidateAttributes() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: attributeKeys.all })
}

export function useCreateAttribute() {
  const invalidate = useInvalidateAttributes()
  return useMutation({
    mutationFn: (values: AttributeValues) => attributesApi.create(values),
    onSuccess: (attribute) => {
      void invalidate()
      toast.success(`${attribute.name} created`)
    },
  })
}

export function useUpdateAttribute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<AttributeValues> }) =>
      attributesApi.update(id, values),
    onSuccess: (attribute) => {
      // PATCH answers without values; keeping the cached ones avoids blanking
      // the panel underneath while the refetch is in flight.
      queryClient.setQueryData<Attribute>(attributeKeys.detail(attribute.id), (current) =>
        current ? { ...attribute, values: current.values } : attribute,
      )
      void queryClient.invalidateQueries({ queryKey: attributeKeys.all })
      toast.success(`${attribute.name} updated`)
    },
  })
}

export function useDeleteAttribute() {
  const invalidate = useInvalidateAttributes()
  return useMutation({
    mutationFn: (id: string) => attributesApi.remove(id),
    onSuccess: () => void invalidate(),
    // No toast here: a blocked delete is a 422 the dialog turns into an
    // explanation with a way forward, which a toast would talk over.
  })
}

// ─── values ──────────────────────────────────────────────────────────────────

export function useCreateAttributeValue(attributeId: string) {
  const invalidate = useInvalidateAttributes()
  return useMutation({
    mutationFn: (values: AttributeValueValues) => attributesApi.createValue(attributeId, values),
    onSuccess: (value) => {
      void invalidate()
      toast.success(`${value.value} added`)
    },
  })
}

export function useUpdateAttributeValue(attributeId: string) {
  const invalidate = useInvalidateAttributes()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<AttributeValueValues> }) =>
      attributesApi.updateValue(attributeId, id, values),
    onSuccess: () => void invalidate(),
  })
}

export function useDeleteAttributeValue(attributeId: string) {
  const invalidate = useInvalidateAttributes()
  return useMutation({
    mutationFn: (id: string) => attributesApi.removeValue(attributeId, id),
    onSuccess: () => void invalidate(),
  })
}

export function useReorderAttributeValues(attributeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => attributesApi.reorderValues(attributeId, ids),
    onSuccess: (values: AttributeValue[]) => {
      // The response is the settled order. Writing it straight into the cache
      // keeps the list still — an invalidate would refetch and re-animate a
      // list the operator just finished dragging.
      queryClient.setQueryData<Attribute>(attributeKeys.detail(attributeId), (current) =>
        current ? { ...current, values } : current,
      )
    },
  })
}
