import argon2 from 'argon2'
import { prisma } from '../../lib/prisma.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { hashPassword, requestEmailVerification } from '../auth/auth.service.js'
import { CUSTOMER_ROLES } from '../../middleware/requireRole.js'
import type {
  ChangePasswordInput,
  UpdateAccountInput,
} from '../../schemas/shop/account.schema.js'

/**
 * A customer editing themselves. Two operations, and the interesting one is
 * neither of them being allowed to touch anything about *who* they are —
 * `role` and `status` are not in the input type, so no amount of body-spreading
 * can reach them.
 */

export async function update(userId: string, input: UpdateAccountInput) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw notFound('Account')

  const emailChanged = Boolean(input.email && input.email !== user.email)

  if (emailChanged) {
    const taken = await prisma.user.findUnique({ where: { email: input.email! } })
    if (taken) throw conflict('That email is already in use', { email: 'Already in use' })
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(emailChanged
        ? {
            email: input.email,
            // Un-verified the moment it changes. Order updates go to an address
            // somebody has proved they can read, or they do not go.
            emailVerifiedAt: null,
          }
        : {}),
    },
  })

  // Best effort: a mailer that is down must not fail the save the customer
  // just made. They can ask for the link again from the account screen.
  if (emailChanged) {
    await requestEmailVerification(updated.email, CUSTOMER_ROLES).catch(() => undefined)
  }

  return { user: updated, verificationEmailSent: emailChanged }
}

/**
 * Changing a password ends every other session, exactly as a reset does. The
 * common reason to change one is that somebody else might know it, and leaving
 * their session alive answers the wrong half of that.
 *
 * The current session survives: signing someone out of the tab they are typing
 * in, as a reward for good security hygiene, is how people stop doing it.
 */
export async function changePassword(
  userId: string,
  currentSessionId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw notFound('Account')

  const correct = await argon2.verify(user.passwordHash, input.currentPassword)
  if (!correct) {
    /**
     * A field error, deliberately **not** a 401.
     *
     * The session is fine — it is the password typed into this form that is
     * wrong, and the two are different failures. A 401 here would be read by
     * the client's interceptor as an expired session and would sign the
     * customer out for mistyping a password, which is both wrong and alarming.
     */
    throw badRequest('That is not your current password', {
      currentPassword: 'That is not your current password',
    })
  }

  if (input.currentPassword === input.newPassword) {
    throw badRequest('Choose a different password', {
      newPassword: 'This is the password you already have',
    })
  }

  const passwordHash = await hashPassword(input.newPassword)

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.userSession.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    }),
    // Any live reset link is spent too: a password change is a statement that
    // the old ways in are closed.
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ])
}
