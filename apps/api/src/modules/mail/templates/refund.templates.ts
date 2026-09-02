import { Prisma } from '@shoe/db'
import { env } from '../../../config/env.js'
import { prisma } from '../../../lib/prisma.js'
import { button, escapeHtml, layout, textFooter, type RenderedMail } from './layout.js'

/**
 * The four messages a refund produces.
 *
 * Like the order templates, **they take an id and read their own rows** — an
 * amount that travelled in a job payload would be a second copy of a number
 * with exactly one home, made before the send rather than at it. That matters
 * more here than anywhere: the figure in a refund email is the figure a
 * customer checks their bank statement against.
 *
 * What they are careful about is tense. A refund that has been *issued* is not
 * a refund that has *arrived*, and saying "refunded" before the provider has
 * settled it is how a support queue fills up on day four. Only
 * `refund.completed` speaks in the past tense, and it is sent by the webhook.
 */

export type RefundRequestMailData = { requestId: string }
export type RefundMailData = { refundId: string }
export type OrderCancelledMailData = { orderId: string }

const money = (value: { toFixed(digits: number): string }, currency: string) =>
  `${currency === 'INR' ? '₹' : `${currency} `}${value.toFixed(2)}`

const orderLink = (orderNumber: string) =>
  `${env.STOREFRONT_URL}/account/orders/${orderNumber}`

const greeting = (firstName: string | null) => `Hi ${firstName ?? 'there'},`

/**
 * Throws when the row is gone, so the queue retries and a genuinely missing
 * record exhausts its attempts into the failed set — visible, unlike a
 * half-rendered email.
 */
async function loadRequest(requestId: string) {
  const request = await prisma.refundRequest.findUnique({
    where: { id: requestId },
    include: {
      order: { select: { orderNumber: true, currency: true } },
      user: { select: { firstName: true } },
      items: { include: { orderItem: { select: { productTitle: true, quantity: true } } } },
    },
  })
  if (!request) throw new Error(`Refund request ${requestId} not found`)
  return request
}

type LoadedRequest = Awaited<ReturnType<typeof loadRequest>>

const itemLines = (request: LoadedRequest) =>
  request.items.map((item) => `  ${item.orderItem.productTitle} x${item.quantity}`).join('\n')

const itemList = (request: LoadedRequest) =>
  request.items
    .map(
      (item) =>
        `<li style="margin:0 0 4px">${escapeHtml(item.orderItem.productTitle)} × ${item.quantity}</li>`,
    )
    .join('')

// ─── the cancellation ────────────────────────────────────────────────────────

/**
 * Sent when the customer cancels their own order. It confirms two things they
 * cannot see from the page alone: the money is on its way, and how long it
 * takes — which is the entire content of the email they would otherwise write
 * to support on day two.
 */
export async function renderOrderCancelled(data: OrderCancelledMailData): Promise<RenderedMail> {
  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    include: {
      user: { select: { firstName: true } },
      refunds: { where: { status: { not: 'FAILED' } }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!order) throw new Error(`Order ${data.orderId} not found`)

  /**
   * Summed from the rows rather than taken from the order total: a cancellation
   * on an order that had already been partially refunded sends back what is
   * left, and quoting the total would promise money that is not coming.
   */
  const refunded = order.refunds.reduce(
    (sum, refund) => sum.plus(refund.amount),
    new Prisma.Decimal(0),
  )
  const amount = money(refunded, order.currency)
  const link = orderLink(order.orderNumber)

  return {
    subject: `Order ${order.orderNumber} cancelled`,
    html: layout({
      title: `Order ${order.orderNumber} cancelled`,
      preheader: `${amount} is on its way back to you.`,
      body: `
      <p style="margin:0 0 16px">${escapeHtml(greeting(order.user?.firstName ?? null))}</p>
      <p style="margin:0 0 24px">Order ${escapeHtml(order.orderNumber)} has been cancelled, as you asked. Nothing has been sent out.</p>
      <p style="margin:0 0 8px;color:#777777;font-size:13px">Refund</p>
      <p style="margin:0 0 24px;font-weight:600">${escapeHtml(amount)}</p>
      <p style="margin:0 0 24px">It goes back to how you paid, and usually takes 5–7 working days to appear. We will email you again once your bank confirms it.</p>
      <p style="margin:0">${button(link, 'View your order')}</p>`,
    }),
    text: `${greeting(order.user?.firstName ?? null)}

Order ${order.orderNumber} has been cancelled, as you asked. Nothing has been sent out.

Refund: ${amount}

It goes back to how you paid, and usually takes 5-7 working days to appear. We will email you again once your bank confirms it.

View your order: ${link}${textFooter()}`,
  }
}

// ─── the decision ────────────────────────────────────────────────────────────

export async function renderReturnApproved(data: RefundRequestMailData): Promise<RenderedMail> {
  const request = await loadRequest(data.requestId)
  const link = orderLink(request.order.orderNumber)
  const amount = money(request.estimatedAmount, request.order.currency)

  return {
    subject: `Your return for ${request.order.orderNumber} is approved`,
    html: layout({
      title: 'Return approved',
      preheader: `Post it back and we will refund ${amount}.`,
      body: `
      <p style="margin:0 0 16px">${escapeHtml(greeting(request.user.firstName))}</p>
      <p style="margin:0 0 24px">Your return for order ${escapeHtml(request.order.orderNumber)} is approved. Send these back to us:</p>
      <ul style="margin:0 0 24px;padding-left:20px">${itemList(request)}</ul>
      <p style="margin:0 0 24px">Pack them as they arrived, with the box if you still have it. We refund <strong>${escapeHtml(amount)}</strong> as soon as the parcel reaches us — delivery charges are not refunded on a return.</p>
      ${request.decisionNote ? `<p style="margin:0 0 24px;color:#555555">${escapeHtml(request.decisionNote)}</p>` : ''}
      <p style="margin:0">${button(link, 'View your order')}</p>`,
    }),
    text: `${greeting(request.user.firstName)}

Your return for order ${request.order.orderNumber} is approved. Send these back to us:

${itemLines(request)}

Pack them as they arrived, with the box if you still have it. We refund ${amount} as soon as the parcel reaches us - delivery charges are not refunded on a return.
${request.decisionNote ? `\n${request.decisionNote}\n` : ''}
View your order: ${link}${textFooter()}`,
  }
}

/**
 * The one email here that carries somebody's decision rather than a fact, which
 * is why the note is not optional in the schema behind it: a rejection with no
 * reason is the message that generates the phone call.
 */
export async function renderReturnRejected(data: RefundRequestMailData): Promise<RenderedMail> {
  const request = await loadRequest(data.requestId)
  const link = orderLink(request.order.orderNumber)

  return {
    subject: `About your return for ${request.order.orderNumber}`,
    html: layout({
      title: 'About your return',
      preheader: 'We are not able to accept this return.',
      body: `
      <p style="margin:0 0 16px">${escapeHtml(greeting(request.user.firstName))}</p>
      <p style="margin:0 0 24px">We have looked at your return for order ${escapeHtml(request.order.orderNumber)}, and we are not able to accept it this time.</p>
      ${request.decisionNote ? `<p style="margin:0 0 24px;padding:16px;background:#f6f6f4;border-radius:4px">${escapeHtml(request.decisionNote)}</p>` : ''}
      <p style="margin:0 0 24px">Nothing has been charged or refunded, and you keep the items. If you think this is wrong, reply to the order confirmation and a person will look at it again.</p>
      <p style="margin:0">${button(link, 'View your order')}</p>`,
    }),
    text: `${greeting(request.user.firstName)}

We have looked at your return for order ${request.order.orderNumber}, and we are not able to accept it this time.
${request.decisionNote ? `\n${request.decisionNote}\n` : ''}
Nothing has been charged or refunded, and you keep the items. If you think this is wrong, reply to the order confirmation and a person will look at it again.

View your order: ${link}${textFooter()}`,
  }
}

// ─── the money landing ───────────────────────────────────────────────────────

/**
 * Sent by the webhook, once the provider has actually settled it — the only
 * message in this file that says "refunded" in the past tense.
 */
export async function renderRefundCompleted(data: RefundMailData): Promise<RenderedMail> {
  const refund = await prisma.refund.findUnique({
    where: { id: data.refundId },
    include: {
      order: {
        select: {
          orderNumber: true,
          currency: true,
          user: { select: { firstName: true } },
        },
      },
    },
  })
  if (!refund) throw new Error(`Refund ${data.refundId} not found`)

  const amount = money(refund.amount, refund.order.currency)
  const link = orderLink(refund.order.orderNumber)

  return {
    subject: `${amount} refunded for ${refund.order.orderNumber}`,
    html: layout({
      title: 'Refund sent',
      preheader: `${amount} is on its way back to your account.`,
      body: `
      <p style="margin:0 0 16px">${escapeHtml(greeting(refund.order.user?.firstName ?? null))}</p>
      <p style="margin:0 0 24px">We have refunded <strong>${escapeHtml(amount)}</strong> for order ${escapeHtml(refund.order.orderNumber)}.</p>
      <p style="margin:0 0 24px">It has gone back to the card or account you paid with. Banks usually show it within 5–7 working days — if it has not appeared by then, your bank can trace it with the date and amount above.</p>
      <p style="margin:0">${button(link, 'View your order')}</p>`,
    }),
    text: `${greeting(refund.order.user?.firstName ?? null)}

We have refunded ${amount} for order ${refund.order.orderNumber}.

It has gone back to the card or account you paid with. Banks usually show it within 5-7 working days - if it has not appeared by then, your bank can trace it with the date and amount above.

View your order: ${link}${textFooter()}`,
  }
}
