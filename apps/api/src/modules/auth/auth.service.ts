import argon2 from 'argon2'
import { Prisma, type User, type UserRole } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { conflict, forbidden, invalidCredentials, unauthorized } from '../../lib/errors.js'
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
import { sendPasswordReset, sendVerifyEmail, sendWelcome } from '../mail/mail.service.js'

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

  return { user, tokens: await startSession(user, context) }
}

/**
 * Mints a session row and the token pair that belongs to it. Extracted so
 * `login` and `register` cannot drift: a register path that forgot to hash the
 * refresh token would leave a placeholder in `refresh_token_hash` and every
 * refresh for that customer would read as token reuse.
 */
async function startSession(
  user: Pick<User, 'id' | 'email' | 'role'>,
  context: SessionContext,
): Promise<TokenPair> {
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

  return tokens
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
  const created = await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_MS),
    },
  })

  // Queued, not sent inline. This endpoint answers 202 identically whether or
  // not the account exists, and waiting on SMTP here would make the response
  // time itself an account-existence oracle — the exact leak the shape of this
  // function was written to close.
  void sendPasswordReset({
    to: user.email,
    firstName: user.firstName,
    token,
    tokenId: created.id,
    audience: user.role === 'CUSTOMER' ? 'shop' : 'admin',
  }).catch((error) => logger.error({ err: error, userId: user.id }, 'could not queue reset email'))

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

// ─── registration ────────────────────────────────────────────────────────────

export type RegisterData = {
  email: string
  password: string
  firstName: string
  lastName?: string | undefined
  phone?: string | undefined
}

/**
 * Storefront signup. `role` is not a parameter: this function only ever makes
 * customers. Staff accounts are created from the admin side, and a role that
 * arrives from a request body is a privilege-escalation bug waiting for one
 * careless spread.
 *
 * A taken email throws 409 rather than returning the same response either way.
 * That is a deliberate, narrow existence oracle: the non-leaking alternative is
 * to accept the signup silently and email the real owner, which needs a mailer
 * this build does not have yet, and which strands a legitimate customer on a
 * screen that will never resolve. Login, reset and resend — the endpoints an
 * attacker can hit unattended — all stay silent.
 */
export async function register(
  data: RegisterData,
  context: SessionContext,
): Promise<{ user: User; tokens: TokenPair; verificationToken: string }> {
  const email = data.email.toLowerCase()

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw conflict('An account with that email already exists', { email: 'Already registered' })
  }

  const passwordHash = await hashPassword(data.password)

  let user: User
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName || null,
        phone: data.phone || null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    })
  } catch (error) {
    // Two signups for the same address in the same tick both pass the check
    // above. The unique index is what actually decides; translate its violation
    // into the same 409 rather than letting a raw P2002 surface.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw conflict('An account with that email already exists', { email: 'Already registered' })
    }
    throw error
  }

  // Signed in immediately: Phase 14 merges the guest cart on register as well
  // as on login, and it needs a session to merge into.
  const tokens = await startSession(user, context)
  const verificationToken = await issueEmailVerificationToken(user)

  return { user, tokens, verificationToken }
}

// ─── email verification ──────────────────────────────────────────────────────

const VERIFICATION_TOKEN_MS = 24 * 60 * 60 * 1000

/**
 * Invalidates any outstanding token before minting a new one, so "resend"
 * cannot leave three live links in three inboxes. Returns the raw token; only
 * its SHA-256 is stored, exactly as password reset does.
 *
 * The invalidation is only real because `verifyEmail` checks `usedAt`. It did
 * not for a long time, and this claim was false the whole while — a superseded
 * link kept working.
 */
async function issueEmailVerificationToken(user: {
  id: string
  email: string
  firstName: string | null
  role: UserRole
}): Promise<string> {
  const token = randomToken(48)
  const [, created] = await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_MS),
      },
    }),
  ])

  /**
   * After the transaction, never inside it. A job queued inside could be picked
   * up before the commit lands, and would survive a rollback that took the
   * token row with it — an email whose link was never valid.
   *
   * Not awaited into the caller's failure path either: the account exists and
   * the token is stored, so a queue that is briefly unreachable must not turn a
   * successful signup into a 500. The customer can always ask for a resend.
   */
  void sendVerifyEmail({
    to: user.email,
    firstName: user.firstName,
    token,
    tokenId: created.id,
    audience: user.role === 'CUSTOMER' ? 'shop' : 'admin',
  }).catch((error) => logger.error({ err: error, userId: user.id }, 'could not queue verification email'))

  return token
}

/**
 * Resend. Returns null — and the caller still answers 202 — when the address is
 * unknown, belongs to staff, or is already verified. Unlike register, this
 * endpoint can be hit unattended, so it must not confirm anything.
 */
export async function requestEmailVerification(
  email: string,
  allowedRoles: readonly UserRole[],
): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user || !allowedRoles.includes(user.role)) return null
  if (user.status === 'SUSPENDED' || user.emailVerifiedAt) return null
  return issueEmailVerificationToken(user)
}

/**
 * Consumes a verification link. Idempotent for the customer who double-clicks:
 * a token already used inside its window still resolves, because the account is
 * verified either way and an error screen after a successful verification is
 * pure confusion. A token that never existed, or has expired, still fails.
 *
 * `alreadyVerified` reports which of those two happened. Both are successes, but
 * "Email verified" is a lie on the second click and the page has no other way to
 * know — the user object looks identical either way.
 */
export async function verifyEmail(
  token: string,
  allowedRoles: readonly UserRole[],
): Promise<{ user: User; alreadyVerified: boolean }> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  })

  if (!record || !allowedRoles.includes(record.user.role)) {
    throw unauthorized('This verification link is invalid or has expired')
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('This verification link is invalid or has expired')
  }

  /**
   * Already verified wins over everything below, and the order is the whole
   * point: a customer who double-clicks the link, or opens it again from their
   * inbox a day later, gets the same success they got the first time. An error
   * screen after a verification that actually worked is pure confusion.
   */
  if (record.user.emailVerifiedAt) return { user: record.user, alreadyVerified: true }

  /**
   * Used, but the account is not verified — so this token was **superseded by a
   * resend**, not consumed. `issueEmailVerificationToken` marks outstanding
   * tokens used before minting a new one, precisely so that three resends do
   * not leave three live links in three inboxes.
   *
   * Without this check that invalidation did nothing: the old link still
   * verified, which is exactly the hole the reset flow closes with the same
   * `usedAt` guard. Reaching here means the customer clicked an older email;
   * the newest one in their inbox is the one that works.
   */
  if (record.usedAt) {
    throw unauthorized('This verification link has been replaced by a newer one')
  }

  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ])

  /**
   * Welcome goes out here rather than at signup, and only for customers.
   *
   * Two emails in the same second means one of them competes with the link the
   * customer actually needs — and sending it here means it lands on an address
   * now known to be real. It sits below the early return above, so a
   * double-clicked link verifies once and welcomes once; the job id keyed on
   * the user makes that belt and braces.
   */
  if (user.role === 'CUSTOMER') {
    void sendWelcome({ to: user.email, firstName: user.firstName, userId: user.id }).catch((error) =>
      logger.error({ err: error, userId: user.id }, 'could not queue welcome email'),
    )
  }

  return { user, alreadyVerified: false }
}
