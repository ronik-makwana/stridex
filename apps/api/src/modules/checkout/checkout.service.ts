import { Prisma, type HoldStatus } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { AppError, forbidden, notFound, unprocessable } from '../../lib/errors.js'
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
import {
  quoteMethods,
  rateFor,
  type ShippingMethodCode,
} from './shipping.methods.js'
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
    include: {
      variant: {
        include: {
          // The product's cover as well as the variant's own image: `mediaId`
          // is null across the catalogue today, and a summary of grey boxes is
          // a summary nobody checks their order against.
          product: { select: { slug: true, media: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
          media: true,
        },
      },
    },
  },
  shippingAddress: true,
  billingAddress: true,
  // Present only once the webhook has landed. It is what a second tab needs in
  // order to redirect to the confirmation instead of trying to pay again (§25).
  order: { select: { id: true, orderNumber: true } },
} satisfies Prisma.CheckoutSessionInclude

async function load(id: string): Promise<CheckoutSessionRecord> {
  const session = await prisma.checkoutSession.findUnique({ where: { id }, include: sessionInclude })
  if (!session) throw notFound('Checkout')
  return session
}

/**
 * The goods total the quote was built on: subtotal less every discount, per-line
 * and order-wide. Recomputed from the same rows rather than stored, so the
 * shipping options are priced against exactly the figure `quoteSession` used.
 */
function goodsTotalOf(session: CheckoutSessionRecord): Prisma.Decimal {
  const itemDiscount = session.items.reduce(
    (running, item) => running.plus(item.discountAmount),
    new Prisma.Decimal(0),
  )
  return session.subtotal.minus(itemDiscount).minus(session.discountAmount)
}

/**
 * Load and serialize — the one way a session leaves this module.
 *
 * The shipping options are attached here rather than in the serializer because
 * pricing them needs the settings row, and a serializer that reaches for the
 * database is a serializer that runs a query per response it renders.
 */
async function present(id: string): Promise<ShopCheckoutPayload> {
  const session = await load(id)
  const settings = await prisma.storeSettings.findUnique({ where: { id: 'store' } })
  return serializeCheckoutSession(session, quoteMethods(goodsTotalOf(session), settings))
}

/**
 * Ownership, and the one place in the storefront that answers **403** rather
 * than 404 (§23).
 *
 * Everywhere else — a product, an address, a review — an id that is not yours
 * is indistinguishable from one that does not exist, because confirming
 * existence is the whole of what an attacker wanted (§18). A checkout id is
 * different in two ways: it is an unguessable uuid nobody but its owner was
 * ever handed, so confirming it leaks nothing; and the customer holding a stale
 * link needs to be told which of the two happened. "This checkout is not yours"
 * sends them back to their cart. "No such checkout" sends them to support.
 */
async function ownedOrThrow(userId: string, id: string) {
  const session = await prisma.checkoutSession.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, expiresAt: true },
  })
  if (!session) throw notFound('Checkout')
  if (session.userId !== userId) throw forbidden('This checkout belongs to a different account')
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

/**
 * The gate in front of every edit to a live session, and the reason it is one
 * function: "can this still be changed" has four different wrong answers, and
 * each of them is a different thing to tell the customer.
 *
 * Expiry is checked here rather than trusted from the row, so a session that
 * ran out while the page sat open releases its stock at the moment somebody
 * touches it rather than whenever a sweep next runs (§2, §24).
 */
async function editableOrThrow(userId: string, id: string) {
  const session = await ownedOrThrow(userId, id)

  if (session.status === 'ACTIVE' && session.expiresAt <= new Date()) {
    await expireIfDue(session.id)
    throw new AppError(
      410,
      SHOP_ERROR_CODES.CHECKOUT_EXPIRED,
      'This checkout expired and the items were released',
      { reason: 'Start again from your cart — the prices are re-read then.' },
    )
  }

  if (session.status === 'PAYMENT_PENDING') {
    // The provider may be about to confirm this exact amount. Moving the money
    // under a payment in flight is how a customer is charged one figure and
    // shown another (§16).
    throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'That payment is being confirmed', {
      reason: 'Wait for it to finish before changing anything.',
    })
  }

  if (session.status === 'COMPLETED') {
    throw new AppError(
      409,
      SHOP_ERROR_CODES.CHECKOUT_ALREADY_COMPLETED,
      'This checkout is already an order',
    )
  }

  if (session.status !== 'ACTIVE') {
    throw new AppError(409, 'CHECKOUT_CANCELLED', 'This checkout was cancelled', {
      reason: 'Start again from your cart.',
    })
  }

  return session
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
 * Shipping: the rate for the service the customer chose, from the static method
 * table and the single settings row. Computed here and nowhere else — a
 * shipping figure the client could compute is a shipping figure the client
 * could disagree with (§21).
 *
 * The threshold is tested against the *discounted* goods total, not the raw
 * subtotal. It reads the same today, when nothing discounts anything, and it is
 * the difference between a coupon buying free delivery as a side effect and not.
 */
async function quoteShipping(
  tx: Prisma.TransactionClient,
  goodsTotal: Prisma.Decimal,
  method: string,
): Promise<Prisma.Decimal> {
  const settings = await tx.storeSettings.findUnique({ where: { id: 'store' } })
  return rateFor(method, goodsTotal, settings)
}

/**
 * The one place the money is decided, and the one place it is written.
 *
 * Everything is recomputed from `checkout_items` — the snapshots taken when the
 * session opened — never from the cart and never from today's catalog. That is
 * what makes the quote stable while a customer types a card number, and what an
 * expired session gets a fresh one of (§6).
 *
 * The order matters because each step feeds the next:
 *
 *   subtotal       = Σ line totals
 *   item_discount  = Σ per-line discounts        ← coupons, in the discount phase
 *   order_discount = cart-wide, capped at (subtotal − item_discount)
 *   shipping       = the chosen method's rate, waived above the threshold
 *   total          = subtotal − discounts + shipping
 *
 * The two discount steps are zero today by decision, not by oversight: coupons
 * come after the checkout flow works end to end. They land here, in this
 * function, and nowhere else — which is the whole reason it exists as one.
 */
async function quoteSession(tx: Prisma.TransactionClient, sessionId: string) {
  const items = await tx.checkoutItem.findMany({
    where: { checkoutSessionId: sessionId },
    select: { totalPrice: true, discountAmount: true },
  })

  let subtotal = new Prisma.Decimal(0)
  let itemDiscount = new Prisma.Decimal(0)
  for (const item of items) {
    subtotal = subtotal.plus(item.totalPrice)
    itemDiscount = itemDiscount.plus(item.discountAmount)
  }

  // Read rather than assumed zero: once a coupon can write it, this function
  // must not be the thing that quietly discards it.
  const session = await tx.checkoutSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { discountAmount: true, shippingMethod: true },
  })

  // Capped so no discount can drive a total below its shipping, which is the
  // only thing standing between a generous coupon and a negative charge.
  const ceiling = subtotal.minus(itemDiscount)
  const orderDiscount = session.discountAmount.greaterThan(ceiling)
    ? ceiling
    : session.discountAmount

  const goodsTotal = ceiling.minus(orderDiscount)
  const shipping = await quoteShipping(tx, goodsTotal, session.shippingMethod)

  return tx.checkoutSession.update({
    where: { id: sessionId },
    data: {
      subtotal,
      discountAmount: orderDiscount,
      shippingAmount: shipping,
      totalAmount: goodsTotal.plus(shipping),
    },
  })
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

  /**
   * One live checkout at a time, and a second attempt is refused rather than
   * quietly replacing the first.
   *
   * Replacing was the earlier behaviour and it hid something the customer
   * should be told: stock is being held for them right now, on a clock. Cancel
   * it silently and they lose minutes they did not know they had; do it while
   * another tab is mid-payment and it is worse. So the answer is a 409 naming
   * the session, and the client offers the two things that actually resolve it
   * — finish it, or cancel it.
   *
   * The exception is the same cart. Opening `/checkout` twice for the bag you
   * already quoted is not a second checkout, it is the same one — a double
   * click, a re-render, a reopened tab — and that resumes.
   */
  const open = await prisma.checkoutSession.findFirst({
    where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    include: { items: { select: { variantId: true, quantity: true } } },
    orderBy: { createdAt: 'desc' },
  })

  if (open) {
    if (!sameLines(open.items, cart.items)) {
      throw new AppError(
        409,
        'CHECKOUT_IN_PROGRESS',
        'You already have a checkout in progress',
        {
          reason: 'Finish it, or cancel it to start a new one with your updated cart.',
          // The id, so the client can link straight to it rather than making
          // the customer go and find it.
          fields: { checkoutSessionId: open.id },
        },
      )
    }

    // Addresses supplied with this call still apply — the caller may be
    // resuming with a delivery address chosen since.
    if (addresses.shippingAddressId || addresses.billingAddressId) {
      await prisma.checkoutSession.update({
        where: { id: open.id },
        data: {
          ...(addresses.shippingAddressId ? { shippingAddressId: addresses.shippingAddressId } : {}),
          ...(addresses.billingAddressId ? { billingAddressId: addresses.billingAddressId } : {}),
        },
      })
    }
    return present(open.id)
  }

  try {
    return await createSession(userId, cart, addresses)
  } catch (error) {
    /**
     * `checkout_sessions_one_active_per_user_idx` fired: another request for
     * this customer created a session in the microseconds since the check
     * above. That request is not a competitor — it is the same customer's
     * double click — so the loser is handed the winner's session rather than an
     * error about a constraint it never knew existed.
     */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await findActive(userId)
      if (winner) return winner
    }
    throw error
  }
}

async function createSession(
  userId: string,
  cart: { items: Prisma.CartItemGetPayload<{ include: typeof cartInclude }>[] },
  addresses: { shippingAddressId: string | null; billingAddressId: string | null },
): Promise<ShopCheckoutPayload> {
  const sessionId = await prisma.$transaction(async (tx) => {
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
    await quoteSession(tx, session.id)

    return session.id
  })

  return present(sessionId)
}

/**
 * Whether a session still quotes the cart in front of us. Variant and quantity
 * only: those are what was reserved and what was priced, and anything else that
 * changed about the cart did not change the quote.
 */
function sameLines(
  sessionItems: { variantId: string; quantity: number }[],
  cartItems: { variantId: string; quantity: number }[],
): boolean {
  if (sessionItems.length !== cartItems.length) return false
  const held = new Map(sessionItems.map((item) => [item.variantId, item.quantity]))
  return cartItems.every((item) => held.get(item.variantId) === item.quantity)
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

// ─── reading ─────────────────────────────────────────────────────────────────

/**
 * The endpoint a refresh, a back button and a returning tab all land on. It
 * restores state and creates nothing (§26, §27) — which is why a payment can
 * be interrupted by a closed laptop and still be recoverable.
 *
 * Two things happen on the way out that make it more than a SELECT:
 *
 *   - **Lazy expiry.** A session past its deadline is expired and its stock
 *     released here, at the moment somebody looks, rather than waiting for a
 *     sweep (§24). The customer is then shown EXPIRED, which is the truth.
 *   - **A completed session names its order.** A second tab that was still on
 *     the payment screen reads this and redirects to the confirmation instead
 *     of trying to pay for something already paid for (§25).
 */
export async function findById(userId: string, id: string): Promise<ShopCheckoutPayload> {
  const session = await ownedOrThrow(userId, id)

  // Before the read, so the payload cannot say ACTIVE about a session whose
  // stock this very call just handed back.
  if (session.status === 'ACTIVE' && session.expiresAt <= new Date()) {
    await expireIfDue(id)
  }

  return present(id)
}

/**
 * The session this customer already has open, if any.
 *
 * Without it a checkout is only reachable by an id the client already holds —
 * which the cart does not, so a customer who backs out has no way to learn that
 * one exists or that stock is being held for them. This is what makes "you have
 * a checkout in progress" possible on the cart page.
 *
 * Anything past its deadline is expired here first, so this can never advertise
 * a session that is holding nothing (§24).
 */
export async function findActive(userId: string): Promise<ShopCheckoutPayload | null> {
  const open = await prisma.checkoutSession.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'PAYMENT_PENDING'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, expiresAt: true },
  })
  if (!open) return null

  if (open.status === 'ACTIVE' && open.expiresAt <= new Date()) {
    await expireIfDue(open.id)
    return null
  }

  return present(open.id)
}

// ─── addresses on a session ──────────────────────────────────────────────────

/**
 * Where it is going, and who is being billed for it — then a re-quote, because
 * shipping is a function of the order and the customer has just changed the
 * order.
 *
 * Billing falls back to shipping when it is omitted. "Same as delivery" is what
 * almost everybody means, and making it a required second choice is making them
 * answer a question they have already answered.
 *
 * The addresses are *pointers*, not copies. The copy is taken when the order is
 * created, into `order_addresses`, so editing a saved address afterwards can
 * never rewrite where a past parcel went (§19).
 */
export async function setAddresses(
  userId: string,
  id: string,
  input: { shippingAddressId: string; billingAddressId?: string },
): Promise<ShopCheckoutPayload> {
  await editableOrThrow(userId, id)

  const billingAddressId = input.billingAddressId ?? input.shippingAddressId
  const wanted = [...new Set([input.shippingAddressId, billingAddressId])]

  const owned = await prisma.address.findMany({
    where: { id: { in: wanted }, userId },
    select: { id: true },
  })
  if (owned.length !== wanted.length) throw notFound('Address')

  await prisma.$transaction(async (tx) => {
    await tx.checkoutSession.update({
      where: { id },
      data: { shippingAddressId: input.shippingAddressId, billingAddressId },
    })
    // Shipping is quoted from the session, so it is re-quoted whenever the
    // session changes — not left to whatever it was when the stock was held.
    await quoteSession(tx, id)
  })

  return present(id)
}

// ─── shipping method ─────────────────────────────────────────────────────────

/**
 * Which delivery service, then a re-quote — the same shape as setting an
 * address, and for the same reason: the customer changed the order, so the
 * order gets priced again.
 *
 * The body carries a *code*, never a rate. That is the whole point of the
 * endpoint: the client says "express" and the server says what express costs,
 * so a tampered request can pick a slower van but never a cheaper bill (§21).
 *
 * `editableOrThrow` is what stops this landing on a session that is already
 * paying. Changing the shipping charge under a payment the provider is holding
 * is how the customer is charged one total and shown another (§10).
 */
export async function setShippingMethod(
  userId: string,
  id: string,
  method: ShippingMethodCode,
): Promise<ShopCheckoutPayload> {
  await editableOrThrow(userId, id)

  await prisma.$transaction(async (tx) => {
    await tx.checkoutSession.update({ where: { id }, data: { shippingMethod: method } })
    await quoteSession(tx, id)
  })

  return present(id)
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
  const session = await ownedOrThrow(userId, id)

  if (session.status === 'PAYMENT_PENDING') {
    throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'That payment is still being confirmed', {
      reason: 'Wait for it to finish before cancelling.',
    })
  }
  // Anything else already released its stock on the way into that state.
  // Cancelling twice is a no-op rather than an error: the customer's intent —
  // "I do not want this" — is satisfied either way.
  if (session.status !== 'ACTIVE') return

  await prisma.$transaction((tx) => releaseSession(tx, id, 'CANCELLED'))
}

export type { HoldStatus }
