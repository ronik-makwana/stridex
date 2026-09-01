import type { User } from '@shoe/db'

/**
 * A customer's view of their own account. Whitelisted, never blacklisted — a
 * column added to `users` must be opted into here rather than appearing in a
 * public response the day someone runs a migration.
 *
 * Deliberately narrower than `serializeAdminUser`: no `status`, because a
 * suspended customer never holds a live session to read it with, and no
 * `updatedAt`, which tells a customer nothing and tells a scraper when
 * accounts get touched. `role` stays — the storefront asserts CUSTOMER on it
 * rather than assuming.
 */
export function serializeShopUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    phone: user.phone,
    role: user.role,
    // A boolean, not the timestamp: the UI only ever asks "should I show the
    // verify banner", and the exact moment is account trivia.
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
  }
}

export type ShopUserPayload = ReturnType<typeof serializeShopUser>
