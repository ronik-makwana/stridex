import type { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { AppError, notFound } from '../../lib/errors.js'
import { SHOP_ERROR_CODES } from '../../schemas/shop/common.schema.js'
import type { StoredCartLine } from '../../schemas/shop/cart.schema.js'
import {
  serializeCart,
  serializeCartLine,
  unknownCartLine,
  type CartLine,
  type CartVariantRecord,
  type ShopCartPayload,
} from '../../serializers/shop/cart.serializer.js'
import {
  MAX_QUANTITY_PER_ITEM,
  availableQuantity,
} from '../../serializers/shop/stock.serializer.js'

/**
 * Two carts, one payload. A guest's lives in localStorage and is priced by
 * `hydrate`; a customer's lives in `cart_items` and is priced by `getCart`.
 * Both go through `resolveLines`, so the two can never disagree about what a
 * bag costs or what is wrong with it — which is the whole reason signing in
 * mid-session does not change the numbers on screen.
 *
 * Nothing here reserves inventory. Filling a cart holds nothing; the hold is
 * created by the checkout session in Phase 15 (§4). Otherwise filling carts is
 * a free denial-of-service against the catalog.
 */

const variantInclude = {
  inventory: true,
  product: {
    include: {
      brand: { select: { id: true, name: true, slug: true } },
      // The cover only. A cart line renders one thumbnail.
      media: { orderBy: { sortOrder: 'asc' }, take: 1 },
    },
  },
  optionAssignments: { include: { optionValue: { include: { variantOption: true } } } },
} satisfies Prisma.ProductVariantInclude

type LineRequest = { id?: string; variantId: string; quantity: number; priceSeen?: string | null }

/**
 * The one place a list of variant ids becomes a priced, checked cart. One query
 * for the whole bag rather than one per line, and the requested order is
 * preserved — a cart that reshuffles itself on every load looks broken.
 */
async function resolveLines(requested: LineRequest[]): Promise<CartLine[]> {
  if (requested.length === 0) return []

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: [...new Set(requested.map((line) => line.variantId))] } },
    include: variantInclude,
  })
  const byId = new Map<string, CartVariantRecord>(variants.map((variant) => [variant.id, variant]))

  return requested.map((line) => {
    const variant = byId.get(line.variantId)
    if (!variant) return { ...unknownCartLine(line.variantId, line.quantity), id: line.id ?? null }
    return serializeCartLine(variant, line)
  })
}

/**
 * The public one. Ids and quantities in, today's prices and stock out, with a
 * reason on every line that could not be honoured as stored.
 *
 * Nothing is written and nothing is remembered: a guest cart belongs to the
 * browser that holds it.
 */
export async function hydrate(items: StoredCartLine[]): Promise<ShopCartPayload> {
  return serializeCart(await resolveLines(items))
}

// ─── the signed-in cart ──────────────────────────────────────────────────────

/**
 * Read-only on purpose, even when a line has to be clamped for display. A GET
 * that quietly rewrites the customer's bag is a GET that changes what they came
 * to look at — the adjustment is reported, and checkout revalidates against
 * live inventory inside the reservation transaction regardless (§17).
 */
export async function getCart(userId: string): Promise<ShopCartPayload> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  })
  if (!cart) return serializeCart([])

  return serializeCart(
    await resolveLines(
      cart.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    ),
  )
}

/** Lazily created: a customer who never adds anything never needs a row. */
async function cartIdFor(userId: string): Promise<string> {
  const existing = await prisma.cart.findUnique({ where: { userId }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.cart.create({ data: { userId }, select: { id: true } })
  return created.id
}

/**
 * What the server is willing to sell right now, whatever the client asked for
 * (§17). The UI's own limit is a courtesy; this is the rule.
 */
async function assertSellable(variantId: string, quantity: number) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { inventory: true, product: { select: { status: true, title: true } } },
  })

  if (!variant || variant.status !== 'ACTIVE' || variant.product.status !== 'ACTIVE') {
    // 404 rather than 422 when it does not exist at all: an id that resolves to
    // nothing must not be distinguishable from one that resolves to a draft
    // product (§18).
    if (!variant) throw notFound('Item')
    throw new AppError(422, SHOP_ERROR_CODES.PRODUCT_UNAVAILABLE, 'This item is no longer available', {
      reason: 'Remove it and pick something else.',
    })
  }

  const available = availableQuantity(variant.inventory)
  if (available <= 0) {
    throw new AppError(422, SHOP_ERROR_CODES.OUT_OF_STOCK, 'That size is sold out')
  }
  if (quantity > available) {
    throw new AppError(
      422,
      SHOP_ERROR_CODES.OUT_OF_STOCK,
      available === 1 ? 'Only 1 left' : `Only ${available} left`,
      { reason: 'Reduce the quantity, or pick another size.' },
    )
  }
  if (quantity > MAX_QUANTITY_PER_ITEM) {
    throw new AppError(
      422,
      SHOP_ERROR_CODES.QUANTITY_EXCEEDED,
      `${MAX_QUANTITY_PER_ITEM} per item is the limit`,
    )
  }
}

/**
 * Adding the same variant twice adds up rather than making a second line — the
 * unique index says one row per variant, and a customer who taps Add twice
 * means two, not an error.
 */
export async function addItem(
  userId: string,
  input: { variantId: string; quantity: number },
): Promise<ShopCartPayload> {
  const cartId = await cartIdFor(userId)
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId: input.variantId } },
    select: { id: true, quantity: true },
  })

  const quantity = (existing?.quantity ?? 0) + input.quantity
  await assertSellable(input.variantId, quantity)

  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity } })
  } else {
    await prisma.cartItem.create({ data: { cartId, variantId: input.variantId, quantity } })
  }

  return getCart(userId)
}

/** Scoped by owner in the `where`, not checked after the read — see §18. */
async function ownedItem(userId: string, itemId: string) {
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: { userId } },
    select: { id: true, variantId: true },
  })
  if (!item) throw notFound('Cart item')
  return item
}

export async function updateItem(
  userId: string,
  itemId: string,
  quantity: number,
): Promise<ShopCartPayload> {
  const item = await ownedItem(userId, itemId)
  await assertSellable(item.variantId, quantity)
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } })
  return getCart(userId)
}

export async function removeItem(userId: string, itemId: string): Promise<ShopCartPayload> {
  const item = await ownedItem(userId, itemId)
  await prisma.cartItem.delete({ where: { id: item.id } })
  return getCart(userId)
}

export async function clear(userId: string): Promise<ShopCartPayload> {
  await prisma.cartItem.deleteMany({ where: { cart: { userId } } })
  return getCart(userId)
}

/**
 * Called on login *and* on register, with whatever the browser was holding.
 *
 * Quantities add up rather than overwrite: someone with two in the bag on their
 * phone and one on their laptop meant three, and picking a winner silently
 * loses the other. Everything is clamped to what is actually sellable, and a
 * line whose variant has since gone is dropped rather than failing the merge —
 * the alternative is a customer who cannot sign in because of a shoe that was
 * discontinued while they were browsing.
 */
export async function merge(userId: string, items: StoredCartLine[]): Promise<ShopCartPayload> {
  if (items.length === 0) return getCart(userId)

  const cartId = await cartIdFor(userId)

  const [variants, existing] = await Promise.all([
    prisma.productVariant.findMany({
      where: { id: { in: [...new Set(items.map((item) => item.variantId))] } },
      include: { inventory: true, product: { select: { status: true } } },
    }),
    prisma.cartItem.findMany({ where: { cartId }, select: { id: true, variantId: true, quantity: true } }),
  ])

  const byVariant = new Map(existing.map((item) => [item.variantId, item]))
  const sellable = new Map(
    variants
      .filter((variant) => variant.status === 'ACTIVE' && variant.product.status === 'ACTIVE')
      .map((variant) => [variant.id, availableQuantity(variant.inventory)]),
  )

  // Guest lines are summed first: the same variant twice in one payload is one
  // line, not two writes racing the unique index.
  const wanted = new Map<string, number>()
  for (const item of items) {
    if (!sellable.has(item.variantId)) continue
    wanted.set(item.variantId, (wanted.get(item.variantId) ?? 0) + item.quantity)
  }

  for (const [variantId, guestQuantity] of wanted) {
    const available = sellable.get(variantId) ?? 0
    if (available <= 0) continue

    const current = byVariant.get(variantId)
    const total = Math.min(
      (current?.quantity ?? 0) + guestQuantity,
      available,
      MAX_QUANTITY_PER_ITEM,
    )

    if (current) {
      // Never downward: the server's own line is what the customer put there
      // while signed in, and clamping it here would silently shrink a bag they
      // never touched this session.
      if (total > current.quantity) {
        await prisma.cartItem.update({ where: { id: current.id }, data: { quantity: total } })
      }
    } else {
      await prisma.cartItem.create({ data: { cartId, variantId, quantity: total } })
    }
  }

  return getCart(userId)
}
