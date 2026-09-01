import type { Prisma } from '@shoe/db'

/**
 * Payments, read-only. There are no action buttons at launch because every
 * mutation arrives through a webhook — a refund button here would be a button
 * that lies about what it did until the provider agrees (§8).
 */

const money = (value: Prisma.Decimal): string => value.toFixed(2)

export type AdminPaymentRecord = Prisma.PaymentGetPayload<{
  include: {
    order: { select: { id: true; orderNumber: true } }
    transactions: true
  }
}>

export function serializeAdminPaymentRow(payment: AdminPaymentRecord) {
  return {
    id: payment.id,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    method: payment.method,
    amount: money(payment.amount),
    currency: payment.currency,
    status: payment.status,
    /** Null while the webhook has not landed — a payment can outlive its order. */
    order: payment.order ? { id: payment.order.id, orderNumber: payment.order.orderNumber } : null,
    createdAt: payment.createdAt,
  }
}

export function serializeAdminPayment(payment: AdminPaymentRecord) {
  return {
    ...serializeAdminPaymentRow(payment),
    /** Whether this attempt carried a client key — the double-click guard (§7). */
    hasIdempotencyKey: Boolean(payment.idempotencyKey),
    /**
     * The ledger. Append-only, oldest first: an authorisation, its capture, and
     * any refund read as a sequence, which is the only way they make sense.
     */
    transactions: [...payment.transactions]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: money(transaction.amount),
        providerTransactionId: transaction.providerTransactionId,
        createdAt: transaction.createdAt,
      })),
    /**
     * Whatever the provider actually said, verbatim, for the 2am read. The UI
     * keeps it collapsed: it is evidence, not a summary.
     */
    providerResponse: payment.providerResponse,
    updatedAt: payment.updatedAt,
  }
}

export type AdminPaymentPayload = ReturnType<typeof serializeAdminPayment>
export type AdminPaymentRowPayload = ReturnType<typeof serializeAdminPaymentRow>
