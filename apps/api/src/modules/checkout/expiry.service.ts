import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import { releaseSession } from './checkout.service.js'

/**
 * The backstop for stock nobody came back for.
 *
 * Expiry has to happen twice, and both are load-bearing (§2, §24). Lazily,
 * whenever a session is read past its deadline — that is what stops a customer
 * paying against a checkout that ran out forty seconds ago. And here, on a
 * sweep, for the sessions nobody ever looks at again: a tab closed at the
 * payment screen holds two pairs of shoes until something goes and takes them
 * back.
 *
 * A sweep alone is not enough, and lazy alone is not either. This is the half
 * that runs when the customer is gone.
 */
export async function sweepExpiredSessions(limit = 200): Promise<{ expired: number }> {
  const due = await prisma.checkoutSession.findMany({
    // Exactly the index `(status, expires_at)` was added for.
    where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  })

  let expired = 0
  for (const session of due) {
    try {
      // One transaction per session, not one for the batch: a single bad row
      // must not roll back the stock everybody else just got back.
      await prisma.$transaction((tx) => releaseSession(tx, session.id, 'EXPIRED'))
      expired += 1
    } catch (error) {
      logger.error({ err: error, sessionId: session.id }, 'Could not expire a checkout session')
    }
  }

  if (expired > 0) logger.info({ expired }, 'Expired abandoned checkout sessions')
  return { expired }
}

/**
 * Holds whose session is no longer ACTIVE but which nobody released — the shape
 * a crash between two writes leaves behind. Rare by construction and cheap to
 * check, and the alternative is stock that is held forever by a session that
 * has been finished for a week.
 */
export async function sweepOrphanedHolds(limit = 200): Promise<{ released: number }> {
  const orphans = await prisma.inventoryReservation.findMany({
    where: {
      status: 'ACTIVE',
      session: { status: { in: ['EXPIRED', 'CANCELLED', 'COMPLETED'] } },
    },
    select: { checkoutSessionId: true, session: { select: { status: true } } },
    take: limit,
  })

  const sessions = [...new Set(orphans.map((hold) => hold.checkoutSessionId))]
  let released = 0

  for (const sessionId of sessions) {
    try {
      // COMPLETED holds should have been CONSUMED, not released — releasing one
      // would hand back stock that has already shipped. Only the dead ones.
      const session = orphans.find((hold) => hold.checkoutSessionId === sessionId)?.session
      if (session?.status === 'COMPLETED') {
        logger.error({ sessionId }, 'A completed session still holds stock — needs a look')
        continue
      }
      await prisma.$transaction((tx) => releaseSession(tx, sessionId, 'EXPIRED'))
      released += 1
    } catch (error) {
      logger.error({ err: error, sessionId }, 'Could not release an orphaned hold')
    }
  }

  if (released > 0) logger.warn({ released }, 'Released orphaned inventory holds')
  return { released }
}
