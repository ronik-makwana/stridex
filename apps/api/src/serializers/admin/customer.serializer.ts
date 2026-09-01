import { Prisma } from '@shoe/db'

/**
 * A customer, as support sees them. Never the password hash, never a token, and
 * never anything that would let an admin act *as* them — the row is here to
 * answer questions on a phone call, not to become a way in.
 */

const money = (value: Prisma.Decimal | null): string => (value ?? new Prisma.Decimal(0)).toFixed(2)

export type AdminCustomerRecord = Prisma.UserGetPayload<{
  select: {
    id: true
    email: true
    firstName: true
    lastName: true
    phone: true
    status: true
    emailVerifiedAt: true
    createdAt: true
    updatedAt: true
  }
}>

/** Lifetime value, computed per query rather than stored — see the reviews note. */
export type CustomerTotals = { orderCount: number; totalSpent: Prisma.Decimal | null }

export function serializeAdminCustomer(
  customer: AdminCustomerRecord,
  totals: CustomerTotals = { orderCount: 0, totalSpent: null },
) {
  return {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null,
    phone: customer.phone,
    status: customer.status,
    /** Derived, not a column: the list shows 'Unverified' from this. */
    emailVerified: customer.emailVerifiedAt !== null,
    emailVerifiedAt: customer.emailVerifiedAt,
    orderCount: totals.orderCount,
    /** Only PAID orders count. A failed checkout is not money anyone spent. */
    totalSpent: money(totals.totalSpent),
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  }
}

export type AdminCustomerPayload = ReturnType<typeof serializeAdminCustomer>
