import type { RequestHandler } from 'express'
import type { UserRole } from '@shoe/db'
import { forbidden, unauthorized } from '../lib/errors.js'

/** Mount after `authenticate`. Order matters: no `req.user` means 401, not 403. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized())
    if (!roles.includes(req.user.role)) return next(forbidden())
    next()
  }
}

export const ADMIN_ROLES = ['ADMIN', 'STAFF'] as const satisfies readonly UserRole[]
export const CUSTOMER_ROLES = ['CUSTOMER'] as const satisfies readonly UserRole[]

/** Any admin-console route. */
export const requireAdminSession = requireRole('ADMIN', 'STAFF')
/** Routes STAFF must not reach: settings, admin users, destructive bulk actions. */
export const requireOwner = requireRole('ADMIN')

/**
 * Any storefront route behind the auth wall: cart writes, checkout, orders,
 * account, reviews. An ADMIN token must not pass — not because staff are
 * untrusted, but because a customer-scoped route reads `req.user.id` as the
 * owner of carts and orders, and an admin arriving there would silently create
 * a customer record under a staff account.
 */
export const requireCustomerSession = requireRole('CUSTOMER')
