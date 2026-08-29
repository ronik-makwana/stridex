import type { User, UserSession } from '@shoe/db'

/** Never let `passwordHash` reach a response. Whitelist, never blacklist. */
export function serializeAdminUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    phone: user.phone,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export function serializeSession(session: UserSession, currentSessionId?: string) {
  return {
    id: session.id,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    createdAt: session.createdAt,
    isCurrent: session.id === currentSessionId,
  }
}

export type AdminUserPayload = ReturnType<typeof serializeAdminUser>
