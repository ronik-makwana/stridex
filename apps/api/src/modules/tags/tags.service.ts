import type { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { slugify } from '../../lib/slug.js'
import { badRequest } from '../../lib/errors.js'
import type { TagListQuery } from '../../schemas/admin/tag.schema.js'

/**
 * Tags have no screen of their own. They are created by typing one on a
 * product, which makes this module two things: the suggestion list that input
 * reads, and the sync that turns a list of typed names into rows.
 */

// ─── list ────────────────────────────────────────────────────────────────────

/**
 * Ordered by use, then alphabetically. The tag someone reaches for is far more
 * likely to be one already on forty products than the one typed once last
 * March, and the input shows the top of this list before anything is typed.
 */
export async function findMany(query: TagListQuery) {
  const rows = await prisma.tag.findMany({
    where: query.q ? { name: { contains: query.q, mode: 'insensitive' } } : undefined,
    include: { _count: { select: { products: true } } },
    take: query.limit,
    orderBy: [{ products: { _count: 'desc' } }, { name: 'asc' }],
  })

  return rows.map(({ _count, ...tag }) => ({ ...tag, productCount: _count.products }))
}

// ─── sync ────────────────────────────────────────────────────────────────────

/**
 * The slug is what makes two spellings one tag: 'Summer Sale', 'summer sale'
 * and 'SUMMER SALE' all normalise to `summer-sale`, so a product cannot end up
 * wearing the same label twice and the storefront cannot end up with three
 * pages for one idea.
 *
 * A name that slugifies to nothing — punctuation, or a script this reduces away
 * — is rejected rather than stored, because the URL it would produce is empty.
 */
function normalize(names: string[]): { name: string; slug: string }[] {
  const bySlug = new Map<string, { name: string; slug: string }>()

  for (const raw of names) {
    const name = raw.trim()
    const slug = slugify(name)
    if (!slug) {
      throw badRequest(`"${name}" cannot be used as a tag`, {
        tags: 'A tag needs at least one letter or number.',
      })
    }
    // First spelling wins, so re-typing a tag does not fight over its casing.
    if (!bySlug.has(slug)) bySlug.set(slug, { name, slug })
  }

  return [...bySlug.values()]
}

/**
 * Names in, ids out — creating whatever does not exist yet. `skipDuplicates`
 * rather than a check-then-insert: two products saved at the same moment can
 * both find a tag missing, and the unique index on `slug` is what settles it.
 */
async function resolveTagIds(
  tx: Prisma.TransactionClient,
  names: string[],
): Promise<string[]> {
  const wanted = normalize(names)
  if (wanted.length === 0) return []

  const slugs = wanted.map((tag) => tag.slug)
  const existing = await tx.tag.findMany({ where: { slug: { in: slugs } }, select: { slug: true } })
  const known = new Set(existing.map((tag) => tag.slug))
  const missing = wanted.filter((tag) => !known.has(tag.slug))

  if (missing.length > 0) {
    await tx.tag.createMany({ data: missing, skipDuplicates: true })
  }

  const rows = await tx.tag.findMany({ where: { slug: { in: slugs } }, select: { id: true } })
  return rows.map((row) => row.id)
}

/**
 * Whole-list replacement, like every other list on a product. Links that
 * survive are left alone rather than deleted and re-inserted — there is nothing
 * on the row to preserve today, but a churned join table is a churned index.
 *
 * A tag left on nothing is deleted. Tags exist only as labels on products, so
 * one with no products is a typo that would otherwise sit in the suggestion
 * list forever, being offered to whoever comes next.
 */
export async function syncProductTags(
  tx: Prisma.TransactionClient,
  productId: string,
  names: string[],
): Promise<void> {
  const tagIds = await resolveTagIds(tx, names)
  const next = new Set(tagIds)

  const existing = await tx.productTag.findMany({ where: { productId }, select: { tagId: true } })
  const current = new Set(existing.map((row) => row.tagId))

  const removed = [...current].filter((tagId) => !next.has(tagId))
  const added = tagIds.filter((tagId) => !current.has(tagId))

  if (removed.length > 0) {
    await tx.productTag.deleteMany({ where: { productId, tagId: { in: removed } } })
  }
  if (added.length > 0) {
    await tx.productTag.createMany({
      data: added.map((tagId) => ({ productId, tagId })),
      skipDuplicates: true,
    })
  }
  if (removed.length > 0) {
    await tx.tag.deleteMany({ where: { id: { in: removed }, products: { none: {} } } })
  }
}
