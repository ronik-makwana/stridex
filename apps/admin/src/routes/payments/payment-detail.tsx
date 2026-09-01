import * as React from 'react'
import { Link, useParams } from 'react-router'
import { Check, Copy, SearchX } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { usePayment } from '@/features/payments/queries'
import { formatDateTime, formatMoney } from '@/lib/format'
import { PaymentRecordBadge } from '@/components/order-status-badge'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * A header and a ledger. No action buttons: mutations arrive by webhook, and a
 * button that marked something refunded locally would be a claim the provider
 * has not agreed to (§8).
 */
export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: payment, isPending, error } = usePayment(id)
  const [showRaw, setShowRaw] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  if (isPending) return <DetailSkeleton />

  if (error || !payment) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={missing ? 'That payment no longer exists' : 'Could not load this payment'}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/payments">Back to payments</Link>
          </Button>
        }
      />
    )
  }

  const raw = JSON.stringify(payment.providerResponse ?? {}, null, 2)

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/payments"
        backLabel="Back to payments"
        title={formatMoney(payment.amount)}
        actions={<PaymentRecordBadge status={payment.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <section className="bg-card rounded-lg border">
            <h2 className="border-b px-5 py-3 text-sm font-semibold">Transactions</h2>
            {payment.transactions.length === 0 ? (
              <p className="text-muted-foreground px-5 py-4 text-sm">
                Nothing yet. A transaction is written when the provider authorises, captures or
                refunds.
              </p>
            ) : (
              // Append-only, oldest first: an authorisation, its capture and any
              // refund only make sense read as a sequence.
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-xs">
                  <tr>
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Provider txn</th>
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payment.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td className="px-5 py-2.5">{transaction.type}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {formatMoney(transaction.amount)}
                      </td>
                      <td className="text-muted-foreground px-5 py-2.5 font-mono text-xs">
                        {transaction.providerTransactionId ?? '—'}
                      </td>
                      <td className="text-muted-foreground px-5 py-2.5 text-xs">
                        {formatDateTime(transaction.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="bg-card rounded-lg border">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-semibold">Raw provider response</h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(raw)
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowRaw(!showRaw)}>
                  {showRaw ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>
            {/* Collapsed by default: it is evidence, not a summary, and it is
                the thing somebody reads at 2am when the ledger disagrees. */}
            {showRaw && (
              <pre className="overflow-x-auto px-5 py-4 font-mono text-xs">{raw}</pre>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="bg-card space-y-3 rounded-lg border p-5 text-sm">
            <h2 className="font-semibold">Details</h2>
            <Field label="Provider" value={payment.provider} />
            <Field label="Provider id" value={payment.providerPaymentId} mono />
            <Field label="Method" value={payment.method ?? '—'} />
            <Field label="Amount" value={formatMoney(payment.amount)} />
            <Field label="Created" value={formatDateTime(payment.createdAt)} />
            <Field
              label="Idempotency key"
              value={payment.hasIdempotencyKey ? 'Present' : 'None — written by a webhook'}
            />
          </section>

          <section className="bg-card rounded-lg border p-5 text-sm">
            <h2 className="font-semibold">Order</h2>
            {payment.order ? (
              <Link
                to={`/orders/${payment.order.id}`}
                className="mt-2 inline-block tabular-nums underline underline-offset-4"
              >
                {payment.order.orderNumber}
              </Link>
            ) : (
              <p className="text-muted-foreground mt-2">
                No order yet. One is written when the provider confirms this payment.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={mono ? 'font-mono text-xs break-all' : ''}>{value}</p>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  )
}
