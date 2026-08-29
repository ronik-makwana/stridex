import argon2 from 'argon2'
import type { User, UserRole } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { forbidden, invalidCredentials, unauthorized } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import {
  REFRESH_TOKEN_MS,
  hashRefreshToken,
  randomToken,
  safeEqual,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './auth.tokens.js'

// Must match packages/db/prisma/seed.ts, or every seeded login triggers a rehash.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const

/**
 * A real argon2id hash of a throwaway value. When the email does not exist we
 * still verify against this, so a missing account and a wrong password take the
 * same time and the endpoint cannot be used to enumerate users.
 */
const DUMMY_HASH_PROMISE = argon2.hash(randomToken(), ARGON2_OPTIONS)

export type SessionContext = {
  userAgent?: string | undefined
  ipAddress?: string | undefined
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export const hashPassword = (password: string) => argon2.hash(password, ARGON2_OPTIONS)

async function issueTokens(
  user: Pick<User, 'id' | 'email' | 'role'>,
  sessionId: string,
): Promise<TokenPair> {
  return {
    accessToken: signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: sessionId,
    }),
    refreshToken: signRefreshToken({ sub: user.id, sid: sessionId }),
    expiresIn: Math.floor(REFRESH_TOKEN_MS / 1000),
  }
}

/**
 * Shared by both audiences. `allowedRoles` is what makes one login endpoint
 * safe to expose twice: the admin controller passes ADMIN | STAFF, the shop
 * controller passes CUSTOMER.
 */
export async function login(
  email: string,
  password: string,
  allowedRoles: readonly UserRole[],
  context: SessionContext,
): Promise<{ user: User; tokens: TokenPair }> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })

  if (!user) {
    await argon2.verify(await DUMMY_HASH_PROMISE, password).catch(() => false)
    throw invalidCredentials()
  }

  const passwordMatches = await argon2.verify(user.passwordHash, password).catch(() => false)
  if (!passwordMatches) throw invalidCredentials()

  // Wrong audience is an authentication failure, not an authorization one:
  // telling a customer "this account exists but is not staff" leaks the roster.
  if (!allowedRoles.includes(user.role)) throw invalidCredentials()

  // Only reveal suspension after the password checked out.
  if (user.status === 'SUSPENDED') {
    throw forbidden('This account has been suspended. Contact an administrator.')
  }

  if (argon2.needsRehash(user.passwordHash, ARGON2_OPTIONS)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    })
  }

  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      // Placeholder: the row needs an id before the token that hashes to it can
      // be signed, and refresh_token_hash is NOT NULL + unique.
      refreshTokenHash: randomToken(),
      userAgent: context.userAgent ?? null,
      ipAddress: context.ipAddress ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
    },
  })

  const tokens = await issueTokens(user, session.id)

  await prisma.userSession.update({
    where: { id: session.id },
    data: { refreshTokenHash: hashRefreshToken(tokens.refreshToken) },
  })

  return { user, tokens }
}

/**
 * Rotates in place: the session id survives, the token hash does not. A replayed
 * older token therefore arrives with a valid signature but a stale hash, which
 * is the reuse signal below.
 */
export async function refresh(
  token: string,
  allowedRoles: readonly UserRole[],
  context: SessionContext,
): Promise<{ user: User; tokens: TokenPair }> {
  let payload
  try {
    payload = verifyRefreshToken(token)
  } catch {
    throw unauthorized('Session expired, sign in again')
  }

  const session = await prisma.userSession.findUnique({
    where: { id: payload.sid },
    include: { user: true },
  })

  if (!session || session.userId !== payload.sub) {
    throw unauthorized('Session expired, sign in again')
  }

  if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Session expired, sign in again')
  }

  // Valid signature, live session, wrong hash: this token was already rotated
  // away, so it is either a replay or a stolen copy. Kill the session rather
  // than every session for the user — a second browser tab racing the refresh
  // hits this same branch, and logging someone out everywhere for that is worse
  // than the attack it would prevent.
  if (!safeEqual(hashRefreshToken(token), session.refreshTokenHash)) {
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    })
    logger.warn({ userId: session.userId, sessionId: session.id }, 'refresh token reuse detected')
    throw unauthorized('Session expired, sign in again')
  }

  const { user } = session
  if (!allowedRoles.includes(user.role) || user.status === 'SUSPENDED') {
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    })
    throw unauthorized('Session expired, sign in again')
  }

  const tokens = await issueTokens(user, session.id)

  await prisma.userSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashRefreshToken(tokens.refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
      userAgent: context.userAgent ?? session.userAgent,
      ipAddress: context.ipAddress ?? session.ipAddress,
    },
  })

  return { user, tokens }
}

/** Idempotent by design: logging out twice, or with a junk cookie, is a 204. */
export async function logout(token: string | undefined): Promise<void> {
  if (!token) return
  try {
    const payload = verifyRefreshToken(token)
    await prisma.userSession.updateMany({
      where: { id: payload.sid, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  } catch {
    // Unverifiable token, nothing to revoke.
  }
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return count
}

const RESET_TOKEN_MS = 60 * 60 * 1000

/**
 * Always resolves, whether or not the email exists. The caller returns the same
 * 202 either way, so the endpoint is not an account-existence oracle.
 */
export async function createPasswordResetToken(
  email: string,
  allowedRoles: readonly UserRole[],
): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user || !allowedRoles.includes(user.role) || user.status === 'SUSPENDED') return null

  const token = randomToken(48)
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_MS),
    },
  })
  return token
}

export async function resetPassword(
  token: string,
  newPassword: string,
  allowedRoles: readonly UserRole[],
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  })

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('This reset link is invalid or has expired')
  }
  if (!allowedRoles.includes(record.user.role)) {
    throw unauthorized('This reset link is invalid or has expired')
  }

  const passwordHash = await hashPassword(newPassword)

  // One transaction: consume the token, change the password, and drop every
  // live session. A password reset that leaves old sessions alive is not a reset.
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.userSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])
}
