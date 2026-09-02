import { env } from '../../../config/env.js'
import { prisma } from '../../../lib/prisma.js'
import { button, escapeHtml, layout, textFooter, type RenderedMail } from './layout.js'

/**
 * The two order emails.
 *
 * **They take an id and read their own rows.** Nothing about the order travels
 * in the job payload — not a price, not an address, not a line item. A payload
 * carrying money would be a second copy of a number that has exactly one home,
 * and it would be a copy made before the send rather than at it.
 *
 * What they read is the **snapshot** on `order_items`: the title, SKU, options
 * and unit price as they were at purchase. Never a join to today's product. An
 * order renamed, repriced or archived since still renders as what was bought.
 */

export type OrderMailData = { orderId: string }

const money = (value: { toFixed(digits: number): string }, currency: string) =>
  `${currency === 'INR' ? '₹' : `${currency} `}${value.toFixed(2)}`

async function loadOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      addresses: true,
      user: { select: { email: true, firstName: true } },
    },
  })
  /**
   * Throws, so the queue retries. An order that is genuinely gone will exhaust
   * its attempts and land in the failed set — which is the correct outcome and
   * a visible one, unlike returning a half-rendered email.
   */
  if (!order) throw new Error(`Order ${orderId} not found`)
  return order
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>

/**
 * `variant_options` is a `{ name, value }[]` snapshot, not a map — the same
 * cast the checkout and admin serializers make. Treating it as a record renders
 * a row of `[object Object]`, which is exactly what it did the first time.
 */
function optionLabel(item: LoadedOrder['items'][number]): string {
  const options = (item.variantOptions ?? []) as { name: string; value: string }[]
  return options.map((option) => `${option.name}: ${option.value}`).join(' · ')
}

function itemRows(order: LoadedOrder): string {
  return order.items
    .map((item) => {
      const options = optionLabel(item)
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eeeeee">
            <div style="font-weight:500">${escapeHtml(item.productTitle)}</div>
            <div style="color:#777777;font-size:13px">${escapeHtml(options)}${options ? ' · ' : ''}Qty ${item.quantity}</div>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #eeeeee;text-align:right;white-space:nowrap">
            ${escapeHtml(money(item.totalPrice, order.currency))}
          </td>
        </tr>`
    })
    .join('')
}

function itemLines(order: LoadedOrder): string {
  return order.items
    .map((item) => {
      const options = optionLabel(item)
      return `  ${item.productTitle}${options ? ` (${options})` : ''} x${item.quantity}  ${money(item.totalPrice, order.currency)}`
    })
    .join('\n')
}

function addressBlock(order: LoadedOrder): string | null {
  const shipping = order.addresses.find((address) => address.type === 'SHIPPING')
  if (!shipping) return null
  return [
    shipping.fullName,
    shipping.addressLine1,
    shipping.addressLine2,
    `${shipping.city}, ${shipping.state} ${shipping.postalCode}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function renderOrderConfirmation(data: OrderMailData): Promise<RenderedMail> {
  const order = await loadOrder(data.orderId)
  const link = `${env.STOREFRONT_URL}/account/orders/${order.orderNumber}`
  const address = addressBlock(order)

  const totals = [
    ['Subtotal', money(order.subtotal, order.currency)],
    ...(order.discountAmount.toNumber() > 0
      ? [['Discount', `−${money(order.discountAmount, order.currency)}`]]
      : []),
    ['Delivery', money(order.shippingAmount, order.currency)],
    ['Total', money(order.totalAmount, order.currency)],
  ]
    .map(
      ([label, value], index, all) =>
        `<tr><td style="padding:4px 0;${index === all.length - 1 ? 'font-weight:600;padding-top:12px' : 'color:#555555'}">${label}</td><td style="padding:4px 0;text-align:right;${index === all.length - 1 ? 'font-weight:600;padding-top:12px' : ''}">${escapeHtml(String(value))}</td></tr>`,
    )
    .join('')

  return {
    subject: `Order ${order.orderNumber} confirmed`,
    html: layout({
      title: `Order ${order.orderNumber} confirmed`,
      preheader: `We have your order and payment. Total ${money(order.totalAmount, order.currency)}.`,
      body: `
      <p style="margin:0 0 16px">Hi ${escapeHtml(order.user?.firstName ?? 'there')},</p>
      <p style="margin:0 0 24px">Thanks — we have your order and your payment. We will email you again when it ships.</p>
      <p style="margin:0 0 8px;color:#777777;font-size:13px">Order number</p>
      <p style="margin:0 0 24px;font-weight:600">${escapeHtml(order.orderNumber)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(order)}</table>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">${totals}</table>
      ${address ? `<p style="margin:24px 0 8px;color:#777777;font-size:13px">Delivering to</p><p style="margin:0 0 24px;white-space:pre-line">${escapeHtml(address)}</p>` : ''}
      <p style="margin:0">${button(link, 'View your order')}</p>`,
    }),
    text: `Hi ${order.user?.firstName ?? 'there'},

Thanks — we have your order and your payment. We will email you again when it ships.

Order ${order.orderNumber}

${itemLines(order)}

Subtotal  ${money(order.subtotal, order.currency)}
${order.discountAmount.toNumber() > 0 ? `Discount  -${money(order.discountAmount, order.currency)}\n` : ''}Delivery  ${money(order.shippingAmount, order.currency)}
Total     ${money(order.totalAmount, order.currency)}
${address ? `\nDelivering to:\n${address}\n` : ''}
View your order: ${link}${textFooter()}`,
  }
}

export async function renderOrderShipped(data: OrderMailData): Promise<RenderedMail> {
  const order = await loadOrder(data.orderId)
  const link = `${env.STOREFRONT_URL}/account/orders/${order.orderNumber}`
  const address = addressBlock(order)

  /**
   * No carrier or tracking number, because `orders` does not carry one yet.
   * The notification is still worth sending — "it has left us" is the thing
   * the customer wants to know — and the link goes to the order page, which is
   * where tracking will appear when the column exists.
   */
  return {
    subject: `Order ${order.orderNumber} is on its way`,
    html: layout({
      title: `Order ${order.orderNumber} is on its way`,
      preheader: 'Your order has left our warehouse.',
      body: `
      <p style="margin:0 0 16px">Hi ${escapeHtml(order.user?.firstName ?? 'there')},</p>
      <p style="margin:0 0 24px">Good news — order ${escapeHtml(order.orderNumber)} has shipped and is on its way to you.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(order)}</table>
      ${address ? `<p style="margin:24px 0 8px;color:#777777;font-size:13px">Delivering to</p><p style="margin:0 0 24px;white-space:pre-line">${escapeHtml(address)}</p>` : ''}
      <p style="margin:0">${button(link, 'Track your order')}</p>`,
    }),
    text: `Hi ${order.user?.firstName ?? 'there'},

Good news — order ${order.orderNumber} has shipped and is on its way to you.

${itemLines(order)}
${address ? `\nDelivering to:\n${address}\n` : ''}
See your order: ${link}${textFooter()}`,
  }
}
