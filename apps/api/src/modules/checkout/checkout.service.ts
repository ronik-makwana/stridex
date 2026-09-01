import { Prisma, type HoldStatus } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { AppError, notFound, unprocessable } from '../../lib/errors.js'
import { SHOP_ERROR_CODES, type ShopErrorCode } from '../../schemas/shop/common.schema.js'
import {
  MAX_QUANTITY_PER_ITEM,
  availableQuantity,
} from '../../serializers/shop/stock.serializer.js'
import {
  serializeCheckoutSession,
  type CheckoutSessionRecord,
  type ShopCheckoutPayload,
} from '../../serializers/shop/checkout.serializer.js'
import type { CreateCheckoutInput } from '../../schemas/shop/checkout.schema.js'

/**
 * The ten minutes between a cart and an order.
 *
 * This is the file the whole phase is about, and the reason is stock: a cart
 * holds nothing, an order needs stock to be there, and the gap between them is
 * where two customers race for the last pair. Everything below exists to make
 * that race have exactly one winner and to make the loser's failure legible.
 *
 * Three rules it will not bend on:
 *
 *   1. **Reserve with a conditional UPDATE, never SELECT-then-UPDATE.** The
 *      database decides who got the last unit, in one statement (§3).
 *   2. **All or nothing.** One short line rolls back the whole session — a
 *      partially reserved checkout is stock held for an order nobody can place.
 *   3. **Every failure is collected before any is reported.** Fixing one line
 *      only to be told about the next is how a customer abandons a cart (§16).
 */

/** Ten minutes. Long enough to type a card, short enough to free the stock. */
const TTL_MINUTES = 10

const sessionInclude = {
  items: {
    include: { variant: { include: { product: { select: { slug: true } }, media: true } } },
  },
  shippingAddress: true,
  billingAddress: true,
} satisfies Prisma.CheckoutSessionInclude

async function load(id: string): Promise<CheckoutSessionRecord> {
  const session = await prisma.checkoutSession.findUnique({ where: { id }, include: sessionInclude })
  if (!session) throw notFound('Checkout')
  return session
}

// ─── releasing ───────────────────────────────────────────────────────────────

/**
 * Hands every held unit back and closes the session. The one path out of an
 * ACTIVE session that does not end in an order — cancel, expiry and the sweep
 * all arrive here.
 *
 * Only `ACTIVE` reservations are released, and the update is conditional on
 * that status, so releasing twice cannot give the same units back twice. That
 * matters more than it looks: an expiry sweep racing an explicit cancel is the
 * normal case, not the exotic one.
 */
export async function releaseSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  status: 'EXPIRED' | 'CANCELLED',
): Promise<void> {
  const holds = await tx.inventoryReservation.findMany({
    where: { checkoutSessionId: sessionId, status: 'ACTIVE' },
  })

  for (const hold of holds) {
    // Conditional on the row still being ACTIVE: two releasers, one release.
    const released = await tx.inventoryReservation.updateMany({
      where: { id: hold.id, status: 'ACTIVE' },
      data: { status: status === 'EXPIRED' ? 'EXPIRED' : 'RELEASED' },
    })
    if (released.count === 0) continue

    await tx.$executeRaw`
      UPDATE inventories
         SET reserved_quantity = GREATEST(reserved_quantity - ${hold.quantity}, 0),
             updated_at = now()
       WHERE variant_id = CAST(${hold.variantId} AS uuid)
    `

    const inventory = await tx.inventory.findUnique({
      where: { variantId: hold.variantId },
      select: { id: true },
    })
    if (inventory) {
      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inventory.id,
          type: 'RELEASE',
          // Positive: units coming back into what can be sold. On-hand does not
          // move — a reservation never took any away, it only spoke for them.
          quantity: hold.quantity,
          referenceType: status === 'EXPIRED' ? 'checkout.expire' : 'checkout.cancel',
          referenceId: sessionId,
        },
      })
    }
  }

  await tx.checkoutSession.updateMany({
    where: { id: sessionId, status: 'ACTIVE' },
    data: { status },
  })
}

/**
 * Lazy expiry. Anything past its moment is expired and released the next time
 * anybody looks at it, so a dead session cannot hold stock until a cron happens
 * to run (§24). The sweep in 15.7 is the belt to this braces, not a substitute.
 */
export async function expireIfDue(sessionId: string): Promise<boolean> {
  const session = await prisma.checkoutSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, expiresAt: true },
  })
  if (!session || session.status !== 'ACTIVE' || session.expiresAt > new Date()) return false

  await prisma.$transaction((tx) => releaseSession(tx, sessionId, 'EXPIRED'))
  return true
}

/** Every ACTIVE session of this customer that is already past its deadline. */
async function expireStale(userId: string): Promise<void> {
  const stale = await prisma.checkoutSession.findMany({
    where: { userId, status: 'ACTIVE', expiresAt: { lte: new Date() } },
    select: { id: true },
  })
  for (const session of stale) await expireIfDue(session.id)
}

// ─── validation ──────────────────────────────────────────────────────────────

type LineFailure = { variantId: string; code: ShopErrorCode; message: string }

const SEVERITY: ShopErrorCode[] = [
  SHOP_ERROR_CODES.PRODUCT_UNAVAILABLE,
  SHOP_ERROR_CODES.OUT_OF_STOCK,
  SHOP_ERROR_CODES.QUANTITY_EXCEEDED,
]

/**
 * One error carrying every line that failed, keyed by variant so the cart can
 * mark them where the customer is already looking. The top-level code is the
 * worst of them, because the client branches on one code and the worst is the
 * one that decides what to say.
 */
function lineFailureError(failures: LineFailure[]): AppError {
  const code =
    SEVERITY.find((candidate) => failures.some((failure) => failure.code === candidate)) ??
    SHOP_ERROR_CODES.OUT_OF_STOCK

  return new AppError(
    422,
    code,
    failures.length === 1
      ? failures[0]!.message
      : `${failures.length} items in your cart need attention`,
    {
      fields: Object.fromEntries(failures.map((failure) => [failure.variantId, failure.message])),
      reason: 'Your cart has been updated. Review it and try again.',
    },
  )
}

// ─── creating ────────────────────────────────────────────────────────────────

const cartInclude = {
  variant: {
    include: {
      inventory: true,
      product: { select: { id: true, status: true, title: true } },
      media: true,
      optionAssignments: { include: { optionValue: { include: { variantOption: true } } } },
    },
  },
} satisfies Prisma.CartItemInclude

/** The option labels, frozen into the line: 'Colour: Black', 'Size: UK 9'. */
function optionSnapshot(
  assignments: Prisma.CartItemGetPayload<{ include: typeof cartInclude }>['variant']['optionAssignments'],
) {
  return assignments.map((assignment) => ({
    name: assignment.optionValue.variantOption?.name ?? '',
    value: assignment.optionValue.value,
  }))
}

/**
 * Shipping: one flat rate, waived above a threshold, both from the single
 * settings row. Computed here and nowhere else — a shipping figure the client
 * could compute is a shipping figure the client could disagree with (§21).
 *
 * The threshold is tested against the discounted goods total, which is the
 * subtotal until 15.3 gives a coupon something to subtract.
 */
async function quoteShipping(goodsTotal: Prisma.Decimal): Promise<Prisma.Decimal> {
  const settings = await prisma.storeSettings.findUnique({ where: { id: 'store' } })
  if (!settings) return new Prisma.Decimal(0)

  const threshold = settings.freeShippingThreshold
  if (threshold && goodsTotal.greaterThanOrEqualTo(threshold)) return new Prisma.Decimal(0)
  return settings.shippingFlatRate
}

/**
 * One transaction, and the order inside it is the design:
 *
 *   validate everything → reserve everything → snapshot → quote
 *
 * Reserving before validating would hold stock for a line that was never going
 * to be sold. Snapshotting before reserving would promise a price for a unit
 * nobody has. And doing any of it outside the transaction would leave a
 * reservation with no session the first time a later step throws.
 */
export async function create(
  userId: string,
  input: CreateCheckoutInput,
): Promise<ShopCheckoutPayload> {
  // Anything of this customer's that has already run out of time goes back to
  // the shelf before we ask whether their cart can be reserved.
  await expireStale(userId)

  const inFlight = await prisma.checkoutSession.findFirst({
    where: { userId, status: 'PAYMENT_PENDING' },
    select: { id: true },
  })
  if (inFlight) {
    // Not a failure of this request so much as a fact about the last one: a
    // payment is out there, and starting a second checkout would reserve the
    // same stock twice while the webhook is still deciding (§26).
    throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'A payment is already in progress', {
      reason: 'Finish or cancel that payment before starting another checkout.',
    })
  }

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: { include: cartInclude, orderBy: { createdAt: 'asc' } } },
  })
  if (!cart || cart.items.length === 0) {
    throw unprocessable('Your cart is empty', 'Add something to it and try again.')
  }

  const addresses = await resolveAddresses(userId, input)

  const sessionId = await prisma.$transaction(async (tx) => {
    // Any ACTIVE session this customer still has is replaced, not stacked. Two
    // open checkouts hold the same stock twice, and the cart has moved on.
    const open = await tx.checkoutSession.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true },
    })
    for (const previous of open) await releaseSession(tx, previous.id, 'CANCELLED')

    // ── 1. validate every line, collecting all of it ────────────────────────
    const failures: LineFailure[] = []

    for (const item of cart.items) {
      const variant = item.variant
      const available = availableQuantity(variant.inventory)

      if (variant.status !== 'ACTIVE' || variant.product.status !== 'ACTIVE') {
        failures.push({
          variantId: variant.id,
          code: SHOP_ERROR_CODES.PRODUCT_UNAVAILABLE,
          message: `${variant.product.title} is no longer available`,
        })
        continue
      }
      if (item.quantity > MAX_QUANTITY_PER_ITEM) {
        failures.push({
          variantId: variant.id,
          code: SHOP_ERROR_CODES.QUANTITY_EXCEEDED,
          message: `${MAX_QUANTITY_PER_ITEM} per item is the limit`,
        })
        continue
      }
      if (available <= 0 || item.quantity > available) {
        failures.push({
          variantId: variant.id,
          code: SHOP_ERROR_CODES.OUT_OF_STOCK,
          message:
            available <= 0
              ? `${variant.product.title} is sold out`
              : `Only ${available} left of ${variant.product.title}`,
        })
      }
    }

    if (failures.length > 0) throw lineFailureError(failures)

    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000)

    const session = await tx.checkoutSession.create({
      data: {
        userId,
        expiresAt,
        // Filled in at the end of this transaction, once the lines are real.
        subtotal: 0,
        totalAmount: 0,
        shippingAddressId: addresses.shippingAddressId,
        billingAddressId: addresses.billingAddressId,
      },
    })

    let subtotal = new Prisma.Decimal(0)

    for (const item of cart.items) {
      const variant = item.variant

      // ── 2. reserve, atomically ───────────────────────────────────────────
      //
      // One statement decides it. The WHERE clause is the whole guarantee:
      // two requests for the last unit both run this, and exactly one of them
      // updates a row. A SELECT first would have both read 1 and both proceed.
      const held = await tx.$executeRaw`
        UPDATE inventories
           SET reserved_quantity = reserved_quantity + ${item.quantity},
               updated_at = now()
         WHERE variant_id = CAST(${variant.id} AS uuid)
           AND quantity - reserved_quantity >= ${item.quantity}
      `

      if (held === 0) {
        // Someone took it between the check above and this line — which is
        // exactly the window this design exists to close. Rolling back the
        // transaction returns every unit already held by it.
        throw lineFailureError([
          {
            variantId: variant.id,
            code: SHOP_ERROR_CODES.OUT_OF_STOCK,
            message: `${variant.product.title} sold out while you were checking out`,
          },
        ])
      }

      // ── 3. the hold, and the ledger row that explains it ─────────────────
      await tx.inventoryReservation.create({
        data: {
          checkoutSessionId: session.id,
          variantId: variant.id,
          quantity: item.quantity,
          expiresAt,
        },
      })

      if (variant.inventory) {
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: variant.inventory.id,
            type: 'RESERVATION',
            // Negative: units leaving what can be sold. On-hand is untouched —
            // nothing has shipped — which is why this row never sums into it.
            quantity: -item.quantity,
            referenceType: 'checkout.reserve',
            referenceId: session.id,
          },
        })
      }

      // ── 5. the snapshot ──────────────────────────────────────────────────
      const totalPrice = variant.price.times(item.quantity)
      subtotal = subtotal.plus(totalPrice)

      await tx.checkoutItem.create({
        data: {
          checkoutSessionId: session.id,
          variantId: variant.id,
          productTitle: variant.product.title,
          sku: variant.sku,
          variantOptions: optionSnapshot(variant.optionAssignments),
          unitPrice: variant.price,
          quantity: item.quantity,
          totalPrice,
        },
      })
    }

    // ── 6. the money ────────────────────────────────────────────────────────
    // Discounts are 15.3's; today the shape is subtotal + shipping = total, and
    // the arithmetic already lives in one place for coupons to slot into.
    const shipping = await quoteShipping(subtotal)

    await tx.checkoutSession.update({
      where: { id: session.id },
      data: { subtotal, shippingAmount: shipping, totalAmount: subtotal.plus(shipping) },
    })

    return session.id
  })

  return serializeCheckoutSession(await load(sessionId))
}

/** Owner-scoped, like everything else a customer owns: not yours is a 404 (§22). */
async function resolveAddresses(userId: string, input: CreateCheckoutInput) {
  const wanted = [input.shippingAddressId, input.billingAddressId].filter(
    (id): id is string => Boolean(id),
  )
  if (wanted.length === 0) return { shippingAddressId: null, billingAddressId: null }

  const owned = await prisma.address.findMany({
    where: { id: { in: wanted }, userId },
    select: { id: true },
  })
  const known = new Set(owned.map((address) => address.id))
  if (wanted.some((id) => !known.has(id))) throw notFound('Address')

  return {
    shippingAddressId: input.shippingAddressId ?? null,
    billingAddressId: input.billingAddressId ?? null,
  }
}

// ─── cancel ──────────────────────────────────────────────────────────────────

/**
 * Pulled forward from 15.3's endpoint list, because the release path had to
 * exist for expiry anyway and stock held by an abandoned test is stock nobody
 * can buy.
 *
 * A session in PAYMENT_PENDING is not cancellable here: the provider may be
 * about to confirm it, and releasing stock under a payment that then succeeds
 * is the one outcome worse than holding it too long (§10).
 */
export async function cancel(userId: string, id: string): Promise<void> {
  const session = await prisma.checkoutSession.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  })
  if (!session) throw notFound('Checkout')

  if (session.status === 'PAYMENT_PENDING') {
    throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'That payment is still being confirmed', {
      reason: 'Wait for it to finish before cancelling.',
    })
  }
  if (session.status !== 'ACTIVE') return

  await prisma.$transaction((tx) => releaseSession(tx, id, 'CANCELLED'))
}

export type { HoldStatus }
