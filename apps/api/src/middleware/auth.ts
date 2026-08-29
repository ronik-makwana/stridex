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
 * The strict variant: also confirms the session is still live and the user is
 * not suspended. Costs one indexed read, so use it only where an immediately
 * revoked session must not survive — `/auth/me` and destructive admin actions.
 */
export const authenticateStrict = [
  authenticate,
  async (req: Request, _res: Response, next: NextFunction) => {
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
  },
] satisfies RequestHandler[]
