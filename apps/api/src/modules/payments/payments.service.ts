import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { AppError, forbidden, notFound, unprocessable } from '../../lib/errors.js'
import { SHOP_ERROR_CODES } from '../../schemas/shop/common.schema.js'
import { getProvider } from './providers/index.js'
import * as checkout from '../checkout/checkout.service.js'

/**
 * Taking money, exactly once.
 *
 * Two things make that hard, and both are handled here rather than in the UI:
 *
 *   1. **A customer can press Pay twice.** The button disables itself, which is
 *      manners rather than correctness — the second request still arrives, from
 *      a double click, a retried fetch, or a reload at the wrong moment. The
 *      `Idempotency-Key` and the unique index on it are what make the second
 *      one return the first one's answer instead of charging again (§7, §13).
 *   2. **The provider is the authority, and it is not here yet.** Nothing in
 *      this file marks an order paid. It moves the session to PAYMENT_PENDING
 *      and stops; the webhook decides the rest (§8, §12).
 */

/** Money leaves for the provider in minor units, never as a float. */
const toPaise = (amount: Prisma.Decimal): number => amount.times(100).toNumber()

const withSessionItems = {
  items: true,
  reservations: { where: { status: 'ACTIVE' as const } },
} satisfies Prisma.CheckoutSessionInclude

/**
 * Everything that must still be true at the moment of paying, re-checked
 * because minutes have passed since the session was quoted (§16).
 *
 * The stock is *already held* by this session's reservations, so this is not a
 * second availability check — it is a check that the hold is still alive and
 * that the session is still one that may be paid for.
 */
async function payableOrThrow(userId: string, checkoutSessionId: string) {
  const session = await prisma.checkoutSession.findUnique({
    where: { id: checkoutSessionId },
    include: withSessionItems,
  })
  if (!session) throw notFound('Checkout')
  // 403 rather than 404, like every other checkout route (§23).
  if (session.userId !== userId) throw forbidden('This checkout belongs to a different account')

  if (session.status === 'COMPLETED') {
    throw new AppError(
      409,
      SHOP_ERROR_CODES.CHECKOUT_ALREADY_COMPLETED,
      'This checkout has already been paid',
      { reason: 'Open your orders to see it.' },
    )
  }

  // Expiry is checked here as well as on read: a session that ran out while the
  // payment sheet was open must not be payable, and the stock goes back now
  // rather than at the next sweep (§2, §24).
  if (session.status === 'ACTIVE' && session.expiresAt <= new Date()) {
    await checkout.expireIfDue(session.id)
    throw new AppError(
      410,
      SHOP_ERROR_CODES.CHECKOUT_EXPIRED,
      'This checkout expired before it was paid',
      { reason: 'The items were released. Start again from your cart.' },
    )
  }

  if (session.status === 'PAYMENT_PENDING') {
    /**
     * An attempt is already out there. A *retry* of it carries the same
     * Idempotency-Key and never reaches this check — it was answered from the
     * stored payment above. Anything arriving here is a second attempt with a
     * fresh key: a second tab, or a reload that lost the key, and honouring it
     * would put two live payments on one session (§7, §25).
     *
     * The way out is not another payment. It is to read the session and the
     * payment back and see how the first one ended (§10, §26) — and if it
     * failed, the webhook returns the session to ACTIVE and paying is allowed
     * again.
     */
    throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'A payment for this checkout is already in progress', {
      reason: 'Wait for it to finish, or refresh to see how it ended.',
    })
  }

  if (session.status === 'EXPIRED' || session.status === 'CANCELLED') {
    throw new AppError(410, SHOP_ERROR_CODES.CHECKOUT_EXPIRED, 'This checkout is no longer open', {
      reason: 'Start again from your cart.',
    })
  }

  if (session.items.length === 0) {
    throw unprocessable('There is nothing to pay for', 'Start again from your cart.')
  }
  if (session.reservations.length === 0) {
    // A live session with no hold is a bug elsewhere, and charging for it would
    // sell stock nobody set aside.
    throw new AppError(409, SHOP_ERROR_CODES.OUT_OF_STOCK, 'The items are no longer held', {
      reason: 'Start again from your cart.',
    })
  }
  if (!session.shippingAddressId) {
    throw unprocessable('Choose a delivery address first')
  }

  return session
}

export type PaymentWithPayload = Prisma.PaymentGetPayload<object> & {
  clientPayload?: Record<string, unknown>
}

/**
 * The same key twice returns the first answer and creates nothing.
 *
 * Deliberately written as insert-and-catch rather than check-then-insert: two
 * clicks half a millisecond apart both pass a `SELECT`, and only the unique
 * index can settle which of them is real (§15). The catch is the happy path of
 * the second one, not an error.
 */
export async function create(
  userId: string,
  input: { checkoutSessionId: string },
  idempotencyKey: string,
): Promise<PaymentWithPayload> {
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey } })
  if (existing) return assertOwner(existing, userId)

  const session = await payableOrThrow(userId, input.checkoutSessionId)
  const provider = getProvider()

  // The order does not exist yet: it is written by the webhook, from the
  // session's snapshots (§8). Until then the payment hangs off nothing, which
  // is why `payments.order_id` cannot be its link back — the reference is.
  const created = await provider.createPayment({
    amountInPaise: toPaise(session.totalAmount),
    currency: session.currency,
    reference: session.id,
  })

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const row = await tx.payment.create({
        data: {
          // No order yet — the webhook writes it. Until then this payment
          // belongs to its session, which is what `checkoutSessionId` is for.
          checkoutSessionId: session.id,
          provider: provider.name,
          providerPaymentId: created.providerPaymentId,
          amount: session.totalAmount,
          currency: session.currency,
          status: 'PENDING',
          idempotencyKey,
        },
      })

      // Conditional: only an ACTIVE session moves. If a webhook has already
      // completed it in the microseconds since the check, this leaves it alone.
      await tx.checkoutSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: { status: 'PAYMENT_PENDING' },
      })

      return row
    })

    return { ...payment, clientPayload: created.clientPayload }
  } catch (error) {
    // The other half of the double click got there first. Its answer is the
    // right one for both of them.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.payment.findUnique({ where: { idempotencyKey } })
      if (winner) return assertOwner(winner, userId)
    }
    throw error
  }
}

/**
 * Whose payment this is, before and after the order exists.
 *
 * A key is scoped to whoever first used it: replaying somebody else's must not
 * hand back their payment, which is also why the key has to be a uuid rather
 * than anything a client could guess or enumerate.
 */
async function assertOwner<T extends { id: string; orderId: string | null; checkoutSessionId: string | null }>(
  payment: T,
  userId: string,
): Promise<T> {
  const owner = await prisma.payment.findUnique({
    where: { id: payment.id },
    select: {
      order: { select: { userId: true } },
      session: { select: { userId: true } },
    },
  })

  const ownerId = owner?.order?.userId ?? owner?.session?.userId
  // An orphan — session deleted, order never written — belongs to nobody it can
  // prove, so nobody may read it back.
  if (!ownerId || ownerId !== userId) {
    throw forbidden('That payment belongs to a different account')
  }
  return payment
}

/** Owner-scoped read, for polling and for the confirmation page (§10, §26). */
export async function findById(userId: string, id: string) {
  const payment = await prisma.payment.findUnique({ where: { id } })
  if (!payment) throw notFound('Payment')
  return assertOwner(payment, userId)
}
