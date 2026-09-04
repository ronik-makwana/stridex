import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { unauthorized } from '../lib/errors.js'
import { verifyAccessToken } from '../modules/auth/auth.tokens.js'

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return undefined
  return header.slice(7).trim() || undefined
}

/**
 * Verifies the access token and attaches `req.user`. Stateless by design —
 * no database round trip — which is the whole reason the access token is short
 * lived. Revocation lands within one access-token lifetime, when the refresh
 * fails.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req)
  if (!token) return next(unauthorized())

  try {
    const payload = verifyAccessToken(token)
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sid,
    }
    next()
  } catch {
    next(unauthorized('Access token is invalid or expired'))
  }
}

/**
 * Attaches `req.user` when a valid token is present and carries on regardless.
 *
 * For endpoints that are public but behave differently for a signed-in
 * customer: the reviews list shows an author their own HIDDEN review and marks
 * their row `isMine`, and neither is a reason to demand a session from everyone
 * else. A bad or expired token is treated as no token — this route was never
 * going to 401, so failing here would only convert a public read into an error.
 */
export const authenticateOptional: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req)
  if (!token) return next()

  try {
    const payload = verifyAccessToken(token)
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sid,
    }
  } catch {
    // Deliberately ignored. See above.
  }
  next()
}

/**
 * Confirms the session is still live and the user is not suspended.
 *
 * Mount after `authenticate`, which is what puts `req.user` there. Costs one
 * indexed read, which is the entire reason the access token is otherwise
 * verified statelessly.
 */
export const assertSessionLive: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const session = await prisma.userSession.findUnique({
      where: { id: req.user!.sessionId },
      select: {
        revokedAt: true,
        expiresAt: true,
        user: { select: { status: true, role: true } },
      },
    })

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.status === 'SUSPENDED'
    ) {
      return next(unauthorized('Session is no longer valid'))
    }

    // Role changes mid-session must take effect without waiting for a refresh.
    req.user!.role = session.user.role
    next()
  } catch (error) {
    next(error)
  }
}

/**
 * The strict variant: authenticated, and the session confirmed still live.
 * Use where an immediately revoked session must not survive — `/auth/me`, and
 * every admin write via `requireLiveSessionForWrites` below.
 */
export const authenticateStrict = [authenticate, assertSessionLive] satisfies RequestHandler[]

/** The methods that change something. A GET can wait for the token to expire. */
const MUTATES = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * Re-checks the session on any admin request that writes.
 *
 * Closes the gap between what `authenticateStrict` was documented to cover —
 * "destructive admin actions" — and where it was actually mounted, which was
 * `/auth/me` and nowhere else. Until this existed, revoking a session or
 * suspending a staff account left that person able to delete products, refund
 * orders and edit discounts for the remaining life of their access token: up to
 * `ACCESS_TOKEN_TTL`, fifteen minutes by default. Firing somebody and having
 * them keep write access for a quarter of an hour is not a theoretical concern.
 *
 * Reads are deliberately left stateless. They are the overwhelming majority of
 * admin traffic, a stale read for a few minutes is recoverable in a way a stale
 * *write* is not, and adding a database round trip to every list request would
 * make the console slower for everyone to close a window that only matters for
 * mutations.
 */
export const requireLiveSessionForWrites: RequestHandler = (req, res, next) => {
  if (!MUTATES.has(req.method)) return next()
  return assertSessionLive(req, res, next)
}
