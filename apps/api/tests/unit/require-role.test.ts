import type { UserRole } from '@shoe/db'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/lib/errors.js'
import {
  requireAdminSession,
  requireCustomerSession,
  requireOwner,
  requireRole,
} from '../../src/middleware/requireRole.js'

/**
 * The authorization gate. Two properties are worth pinning down, and both are
 * about telling the wrong things apart:
 *
 *   - no session is 401, wrong role is 403. Collapsing them either sends a
 *     signed-in customer to the login screen forever, or tells an anonymous
 *     caller that the resource exists.
 *   - an ADMIN token must not pass a customer gate. Not because staff are
 *     untrusted, but because those routes read `req.user.id` as the owner of a
 *     cart, and an admin arriving there creates orders under a staff account.
 */

function run(middleware: ReturnType<typeof requireRole>, role?: UserRole) {
  const next = vi.fn()
  const req = role ? { user: { id: 'u1', email: 'a@b.c', role, sessionId: 's1' } } : {}
  middleware(req as never, {} as never, next)

  const error = next.mock.calls[0]?.[0] as AppError | undefined
  return { called: next.mock.calls.length, error }
}

describe('requireRole', () => {
  it('calls through for a role on the list', () => {
    const { error } = run(requireRole('ADMIN'), 'ADMIN')
    expect(error).toBeUndefined()
  })

  it('accepts any of several roles', () => {
    expect(run(requireRole('ADMIN', 'STAFF'), 'STAFF').error).toBeUndefined()
    expect(run(requireRole('ADMIN', 'STAFF'), 'ADMIN').error).toBeUndefined()
  })

  /** Order matters at the mount site: no `req.user` means 401, not 403. */
  it('answers 401 when there is no session at all', () => {
    const { error } = run(requireRole('ADMIN'))
    expect(error).toBeInstanceOf(AppError)
    expect(error?.statusCode).toBe(401)
    expect(error?.code).toBe('UNAUTHORIZED')
  })

  it('answers 403 for a session with the wrong role', () => {
    const { error } = run(requireRole('ADMIN'), 'CUSTOMER')
    expect(error?.statusCode).toBe(403)
    expect(error?.code).toBe('FORBIDDEN')
  })

  it('always ends the chain exactly once', () => {
    expect(run(requireRole('ADMIN'), 'ADMIN').called).toBe(1)
    expect(run(requireRole('ADMIN'), 'CUSTOMER').called).toBe(1)
    expect(run(requireRole('ADMIN')).called).toBe(1)
  })
})

describe('the mounted gates', () => {
  it('lets ADMIN and STAFF into the admin console', () => {
    expect(run(requireAdminSession, 'ADMIN').error).toBeUndefined()
    expect(run(requireAdminSession, 'STAFF').error).toBeUndefined()
  })

  it('keeps a customer out of the admin console', () => {
    expect(run(requireAdminSession, 'CUSTOMER').error?.statusCode).toBe(403)
  })

  /** Settings, admin users, destructive bulk actions: owner only. */
  it('keeps STAFF out of owner-only routes', () => {
    expect(run(requireOwner, 'ADMIN').error).toBeUndefined()
    expect(run(requireOwner, 'STAFF').error?.statusCode).toBe(403)
  })

  it('lets a customer through the storefront gate', () => {
    expect(run(requireCustomerSession, 'CUSTOMER').error).toBeUndefined()
  })

  /**
   * The one that is easy to get wrong: an admin is *more* privileged, so a gate
   * written as "at least a session" would let them in — and they would then own
   * a cart.
   */
  it.each(['ADMIN', 'STAFF'] as UserRole[])('keeps %s out of customer-scoped routes', (role) => {
    expect(run(requireCustomerSession, role).error?.statusCode).toBe(403)
  })
})
