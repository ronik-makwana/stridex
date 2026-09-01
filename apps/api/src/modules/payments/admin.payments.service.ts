import type { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import {
  serializeAdminPayment,
  serializeAdminPaymentRow,
  type AdminPaymentPayload,
  type AdminPaymentRowPayload,
} from '../../serializers/admin/payment.serializer.js'
import type { PaymentListQuery } from '../../schemas/admin/payment.schema.js'

/** Read-only, entirely. Every write to `payments` comes from a webhook (§8). */

const paymentInclude = {
  order: { select: { id: true, orderNumber: true } },
  transactions: true,
} satisfies Prisma.PaymentInclude

const SORT_COLUMNS = {
  created_at: 'createdAt',
  amount: 'amount',
} as const satisfies Record<string, keyof Prisma.PaymentOrderByWithRelationInput>

export async function findMany(
  query: PaymentListQuery,
): Promise<{ data: AdminPaymentRowPayload[]; total: number }> {
  const where: Prisma.PaymentWhereInput = {}
  if (query.status) where.status = query.status
  if (query.provider) where.provider = query.provider
  if (query.q) {
    where.OR = [
      { providerPaymentId: { contains: query.q, mode: 'insensitive' } },
      { order: { orderNumber: { contains: query.q, mode: 'insensitive' } } },
    ]
  }

  const [rows, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: [{ [SORT_COLUMNS[query.sort.field]]: query.sort.direction }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.payment.count({ where }),
  ])

  return { data: rows.map(serializeAdminPaymentRow), total }
}

export async function findById(id: string): Promise<AdminPaymentPayload> {
  const payment = await prisma.payment.findUnique({ where: { id }, include: paymentInclude })
  if (!payment) throw notFound('Payment')
  return serializeAdminPayment(payment)
}

/** The ledger alone, for the panel that renders only the transactions. */
export async function transactions(id: string) {
  const payment = await findById(id)
  return payment.transactions
}
