import type { Tag } from '@shoe/db'

/**
 * `productCount` is set by the tag list, which sums the join table, and left
 * off everywhere a tag is serialized as part of a product — there the number
 * would be one more query per chip for something nothing renders.
 */
type TagWithCount = Tag & { productCount?: number }

export function serializeAdminTag(tag: TagWithCount) {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    productCount: tag.productCount ?? 0,
  }
}

export type AdminTagPayload = ReturnType<typeof serializeAdminTag>
