import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { sendOrderConfirmation } from './mail.service.js'

/**
 * The cheap half of a transactional outbox.
 *
 * An order is created inside a transaction and its confirmation is queued after
 * that transaction commits — it has to be, or the worker could read an order
 * that does not exist yet. Which leaves a gap of a few milliseconds: a process
 * that dies between COMMIT and `queue.add` has taken payment and will never
 * send a confirmation, and nothing anywhere records that it should have.
 *
 * `orders.confirmation_sent_at` records it. This sweep reads the column.
 *
 * A full outbox table with its own poller would close the same gap more
 * rigorously, and is not worth it here: the failure being guarded against is a
 * missing email, not a lost payment, and the money path already has webhook
 * retries and reconciliation behind it.
 */

/** Long enough that an order queued normally is never picked up twice. */
const GRACE_MS = 5 * 60_000

export async function sweepUnsentConfirmations(limit = 50): Promise<{ queued: number }> {
  const candidates = await prisma.order.findMany({
    where: {
      paymentStatus: 'PAID',
      confirmationSentAt: null,
      createdAt: { lt: new Date(Date.now() - GRACE_MS) },
    },
    select: { id: true, orderNumber: true, user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  let queued = 0
  for (const order of candidates) {
    // No account, no address. Stamp it so the sweep stops reconsidering it on
    // every pass for the rest of the order's life.
    if (!order.user?.email) {
      await prisma.order.update({
        where: { id: order.id },
        data: { confirmationSentAt: new Date() },
      })
      continue
    }

    try {
      await sendOrderConfirmation({ to: order.user.email, orderId: order.id })
      await prisma.order.update({
        where: { id: order.id },
        data: { confirmationSentAt: new Date() },
      })
      queued += 1
      logger.warn(
        { orderId: order.id, orderNumber: order.orderNumber },
        'queued a confirmation the checkout path missed',
      )
    } catch (error) {
      // Left null deliberately: the next pass tries again.
      logger.error({ err: error, orderId: order.id }, 'sweep could not queue a confirmation')
    }
  }

  return { queued }
}
