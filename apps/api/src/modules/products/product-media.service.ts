import type { ProductMedia } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import {
  keyFromUrl,
  presignUpload,
  publicUrl,
  removeObjectByUrl,
  statObject,
  type PresignedUpload,
} from '../../config/minio.js'
import type {
  CreateMediaInput,
  PresignMediaInput,
  UpdateMediaInput,
} from '../../schemas/admin/product.schema.js'
import { assertProductExists } from './products.repository.js'

/**
 * Media is a two-step write, and the split is deliberate:
 *
 *   1. presign — the API signs a URL and records nothing
 *   2. PUT     — the browser sends the bytes straight to storage
 *   3. record  — the API confirms the object landed and writes the row
 *
 * Step 3 stats the object before writing anything. An upload that failed, was
 * cancelled, or was never made leaves an orphaned key and no row, which costs
 * storage; the reverse — a row with no object — is a broken image in the
 * gallery that nobody can explain, so the check is not optional.
 */

export function presign(
  productId: string,
  input: PresignMediaInput,
): Promise<PresignedUpload> {
  return assertProductExists(productId).then(() =>
    presignUpload('products', input.filename, input.contentType),
  )
}

/** New media lands at the end. The cover is position 0 and is never taken by surprise. */
async function nextSortOrder(productId: string): Promise<number> {
  const last = await prisma.productMedia.findFirst({
    where: { productId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  return (last?.sortOrder ?? -1) + 1
}

export async function record(
  productId: string,
  input: CreateMediaInput,
): Promise<ProductMedia> {
  await assertProductExists(productId)

  // The key has to be one this API handed out, in this bucket, for this folder.
  // Anything else is a client naming its own object, which is how one product's
  // delete ends up removing another's image.
  if (!input.key.startsWith('products/')) {
    throw badRequest('That upload key is not one this product can use', {
      key: 'Start the upload again.',
    })
  }

  const stat = await statObject(input.key)
  if (!stat) {
    throw badRequest('That file never finished uploading', {
      file: 'The upload did not complete. Try again.',
    })
  }

  return prisma.productMedia.create({
    data: {
      productId,
      url: publicUrl(input.key),
      altText: input.altText ?? null,
      type: stat.contentType?.startsWith('video/') ? 'VIDEO' : 'IMAGE',
      sortOrder: await nextSortOrder(productId),
    },
  })
}

export function findMany(productId: string): Promise<ProductMedia[]> {
  return prisma.productMedia.findMany({
    where: { productId },
    orderBy: { sortOrder: 'asc' },
  })
}

async function findOrThrow(productId: string, mediaId: string): Promise<ProductMedia> {
  const media = await prisma.productMedia.findUnique({ where: { id: mediaId } })
  // Media belonging to another product is a 404 here, not a 403: as far as this
  // URL is concerned it does not exist.
  if (!media || media.productId !== productId) throw notFound('Media')
  return media
}

export async function update(
  productId: string,
  mediaId: string,
  input: UpdateMediaInput,
): Promise<ProductMedia> {
  await findOrThrow(productId, mediaId)
  return prisma.productMedia.update({
    where: { id: mediaId },
    data: { altText: input.altText ?? null },
  })
}

/**
 * Deleting closes the gap in `sort_order`, so the remaining images keep a dense
 * 0..n-1 order and whatever is left at 0 becomes the cover. Variants pointing at
 * this image fall back to the product gallery — `media_id` is `SetNull`.
 */
export async function remove(productId: string, mediaId: string): Promise<void> {
  const media = await findOrThrow(productId, mediaId)

  await prisma.$transaction(async (tx) => {
    await tx.productMedia.delete({ where: { id: mediaId } })
    const remaining = await tx.productMedia.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    })
    for (const [index, row] of remaining.entries()) {
      await tx.productMedia.update({ where: { id: row.id }, data: { sortOrder: index } })
    }
  })

  // After the row is gone: an object left behind costs storage, a row pointing
  // at a deleted object is a broken image.
  if (keyFromUrl(media.url)) await removeObjectByUrl(media.url)
}

/**
 * Positions are rewritten from the array index in one transaction. Setting a
 * cover is the same call with that image first — one operation instead of two
 * that could disagree about which image is at position 0.
 */
export async function reorder(productId: string, ids: string[]): Promise<ProductMedia[]> {
  await assertProductExists(productId)

  const existing = await prisma.productMedia.findMany({
    where: { productId },
    select: { id: true },
  })

  const known = new Set(existing.map((row) => row.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) throw notFound(unknown.length === 1 ? 'Media' : 'Media items')

  // A short list would silently renumber the rest to trailing positions. The
  // client always holds the full gallery, so a partial one is a bug worth naming.
  if (ids.length !== existing.length) {
    throw conflict('That order is out of date — the gallery changed while you were dragging', {
      ids: 'Reload and try again',
    })
  }

  await prisma.$transaction(
    ids.map((id, index) => prisma.productMedia.update({ where: { id }, data: { sortOrder: index } })),
  )

  return findMany(productId)
}
