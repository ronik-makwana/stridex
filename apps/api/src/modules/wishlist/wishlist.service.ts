import type { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import {
  serializeWishlistItem,
  type ShopWishlistItemPayload,
  type WishlistProductRecord,
} from '../../serializers/shop/wishlist.serializer.js'

/**
 * The wishlist is the cart's quieter twin: same guest-then-signed-in split,
 * same hydrate-and-merge, but nothing here is ever bought, so there is no
 * stock check to fail and no quantity to clamp. A saved product that has sold
 * out stays saved — that is rather the point of saving it.
 *
 * What it will not do is keep a product that has left the catalog. An archived
 * or draft product is dropped from every read, because a wishlist tile is a
 * link to a page that would 404 (§18).
 */

const productInclude = {
  brand: { select: { id: true, name: true, slug: true } },
  media: { orderBy: { sortOrder: 'asc' }, take: 1 },
  variants: {
    include: {
      inventory: true,
      optionAssignments: { include: { optionValue: { include: { variantOption: true } } } },
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.ProductInclude

async function loadProducts(ids: string[]): Promise<Map<string, WishlistProductRecord>> {
  if (ids.length === 0) return new Map()
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(ids)] }, status: 'ACTIVE' },
    include: productInclude,
  })
  return new Map(products.map((product) => [product.id, product]))
}

/**
 * Public. Ids in, tiles out, in the order the browser holds them — most
 * recently saved first is the client's business, not ours.
 *
 * Anything that no longer resolves is simply absent from the response. Unlike
 * the cart there is no reason to explain: nothing was going to be charged for,
 * and a tile that says "this thing you saved is gone" is a worse answer than
 * quietly not showing it.
 */
export async function hydrate(productIds: string[]): Promise<ShopWishlistItemPayload[]> {
  const byId = await loadProducts(productIds)
  const now = new Date()
  return productIds.flatMap((id) => {
    const product = byId.get(id)
    return product ? [serializeWishlistItem(product, now)] : []
  })
}

// ─── the signed-in wishlist ──────────────────────────────────────────────────

export async function getWishlist(userId: string): Promise<ShopWishlistItemPayload[]> {
  const wishlist = await prisma.wishlist.findUnique({
    where: { userId },
    // Newest first: a wishlist is a stack of intentions, and the top of it is
    // what someone was just looking at.
    include: { items: { orderBy: { createdAt: 'desc' } } },
  })
  if (!wishlist) return []

  const byId = await loadProducts(wishlist.items.map((item) => item.productId))
  return wishlist.items.flatMap((item) => {
    const product = byId.get(item.productId)
    return product ? [serializeWishlistItem(product, item.createdAt)] : []
  })
}

/** Lazily created, like the cart: saving the first thing is what makes the row. */
async function wishlistIdFor(userId: string): Promise<string> {
  const existing = await prisma.wishlist.findUnique({ where: { userId }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.wishlist.create({ data: { userId }, select: { id: true } })
  return created.id
}

/**
 * Saving twice is not an error — the heart is a toggle in most of the UI and a
 * button in the rest, and both can arrive twice. `skipDuplicates` makes the
 * second one a no-op instead of a 409 the client would have to swallow.
 */
export async function addItem(userId: string, productId: string): Promise<ShopWishlistItemPayload[]> {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!product) throw notFound('Product')

  const wishlistId = await wishlistIdFor(userId)
  await prisma.wishlistItem.createMany({ data: [{ wishlistId, productId }], skipDuplicates: true })
  return getWishlist(userId)
}

/**
 * Keyed by product, not by row id. The client knows what it saved; making it
 * also remember a join-row id would mean the heart on a product card could not
 * unsave without a lookup first.
 */
export async function removeItem(userId: string, productId: string): Promise<ShopWishlistItemPayload[]> {
  const deleted = await prisma.wishlistItem.deleteMany({
    where: { productId, wishlist: { userId } },
  })
  if (deleted.count === 0) throw notFound('Wishlist item')
  return getWishlist(userId)
}

/**
 * Called on login and on register, with whatever the browser held. A union,
 * not a replacement: saving on a phone and then signing in on a laptop should
 * end with both, and there is no quantity here to reconcile.
 */
export async function merge(userId: string, productIds: string[]): Promise<ShopWishlistItemPayload[]> {
  if (productIds.length === 0) return getWishlist(userId)

  const wishlistId = await wishlistIdFor(userId)
  const live = await prisma.product.findMany({
    where: { id: { in: [...new Set(productIds)] }, status: 'ACTIVE' },
    select: { id: true },
  })

  await prisma.wishlistItem.createMany({
    data: live.map((product) => ({ wishlistId, productId: product.id })),
    skipDuplicates: true,
  })

  return getWishlist(userId)
}
