import axios from 'axios'
import { api, del, get, patch, post } from '@/lib/api-client'
import type {
  ApiListResponse,
  BulkResult,
  EntityStatus,
  GenerateResult,
  PresignedUpload,
  Product,
  ProductListQuery,
  ProductMedia,
  ProductVariant,
  PublishChecklist,
} from '@/types/api'
import type {
  BulkVariantValues,
  GenerateValues,
  ProductValues,
  VariantValues,
} from './schemas'

/** What the presign accepts. Kept in step with `ACCEPTED_MEDIA_TYPES` on the API. */
export const ACCEPTED_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
] as const

/**
 * Bigger than the logo limit because product galleries carry real photography
 * and the occasional clip — and because none of it passes through Node, so the
 * ceiling is storage's problem rather than the API's memory.
 */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024

export const productsApi = {
  // The list needs `meta`, so it goes through axios directly rather than the
  // `get()` helper, which unwraps to `data` alone.
  list: async (params: ProductListQuery) => {
    const response = await api.get<ApiListResponse<Product>>('/products', { params })
    return response.data
  },

  get: (id: string) => get<Product>(`/products/${id}`),

  create: (body: ProductValues) => post<Product>('/products', body),

  update: (id: string, body: Partial<ProductValues>) => patch<Product>(`/products/${id}`, body),

  setStatus: (id: string, status: EntityStatus) =>
    patch<Product>(`/products/${id}/status`, { status }),

  /** Read-only. Drives the popover on the Publish button before anyone clicks it. */
  publishChecklist: (id: string) => get<PublishChecklist>(`/products/${id}/publish-checklist`),

  publish: (id: string) => post<Product>(`/products/${id}/publish`),

  archive: (id: string) => post<Product>(`/products/${id}/archive`),

  duplicate: (
    id: string,
    body: { title: string; includeMedia: boolean; includeVariants: boolean; includeInventory: boolean },
  ) => post<Product>(`/products/${id}/duplicate`, body),

  remove: (id: string) => del(`/products/${id}`),

  bulk: (body: { ids: string[]; action: string; categoryId?: string | null }) =>
    post<BulkResult>('/products/bulk', body),

  // ─── media ─────────────────────────────────────────────────────────────────

  presignMedia: (id: string, body: { filename: string; contentType: string }) =>
    post<PresignedUpload>(`/products/${id}/media/presign`, body),

  recordMedia: (id: string, body: { key: string; altText?: string | null }) =>
    post<ProductMedia>(`/products/${id}/media`, body),

  updateMedia: (id: string, mediaId: string, body: { altText: string | null }) =>
    patch<ProductMedia>(`/products/${id}/media/${mediaId}`, body),

  removeMedia: (id: string, mediaId: string) => del(`/products/${id}/media/${mediaId}`),

  /** Answers with the settled gallery. Setting a cover is this call, cover first. */
  reorderMedia: (id: string, ids: string[]) =>
    patch<ProductMedia[]>(`/products/${id}/media/reorder`, { ids }),

  // ─── variants ──────────────────────────────────────────────────────────────

  listVariants: (id: string) => get<ProductVariant[]>(`/products/${id}/variants`),

  createVariant: (id: string, body: VariantValues) =>
    post<ProductVariant>(`/products/${id}/variants`, body),

  updateVariant: (id: string, variantId: string, body: Partial<VariantValues>) =>
    patch<ProductVariant>(`/products/${id}/variants/${variantId}`, body),

  removeVariant: (id: string, variantId: string) => del(`/products/${id}/variants/${variantId}`),

  bulkVariants: (id: string, body: BulkVariantValues) =>
    patch<ProductVariant[]>(`/products/${id}/variants/bulk`, body),

  generateVariants: (id: string, body: GenerateValues) =>
    post<GenerateResult>(`/products/${id}/variants/generate`, body),
}

/**
 * The PUT the whole presign dance exists for. A bare axios call, not `api`:
 * this request goes to object storage, not to our API, and must carry neither
 * the Authorization header nor the credentials the interceptors would attach —
 * S3 rejects a signed URL that arrives with extra auth.
 *
 * `onProgress` is the reason a gallery upload feels different from a logo one:
 * 20MB with no feedback reads as a hung page.
 */
export async function putToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  await axios.put(uploadUrl, file, {
    headers: { 'Content-Type': file.type },
    withCredentials: false,
    timeout: 5 * 60_000,
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) return
      onProgress(Math.round((event.loaded / event.total) * 100))
    },
  })
}
