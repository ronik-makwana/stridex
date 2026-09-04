import { MAIL_PRIORITY, mailQueue } from '../../lib/queue.js'
import { getProvider } from './providers/index.js'
import { isTemplateName, templates, type TemplateName } from './templates/index.js'

/**
 * Enqueue an email, and process one. The two halves of the pipe, and the only
 * surface Phase 23 needs.
 *
 * Nothing here sends synchronously on the request path. A signup that waits on
 * SMTP is a signup that fails when the provider is slow, and one that catches
 * and ignores the error is a customer with no verification link and no way to
 * ask for another.
 */

export type MailJobData = {
  template: TemplateName
  to: string
  /** Ids, not content — see the note on `Renderer`. */
  data: Record<string, unknown>
}

export type EnqueueOptions = {
  /** Defaults to BACKGROUND. Pass INTERACTIVE when somebody is waiting. */
  priority?: number
  /**
   * Deduplication key. Two jobs with the same id are one job, which is how a
   * retried webhook sends one confirmation rather than three. Phase 23 gives
   * every message type a deterministic one; the shapes are in the plan doc.
   */
  jobId?: string
}

export async function enqueueMail(job: MailJobData, options: EnqueueOptions = {}): Promise<void> {
  await mailQueue.add(job.template, job, {
    priority: options.priority ?? MAIL_PRIORITY.BACKGROUND,
    ...(options.jobId ? { jobId: options.jobId } : {}),
  })
}

// ─── the messages, one helper each ───────────────────────────────────────────

/**
 * `-` separates the prefix from the id, not `:`. BullMQ composes its Redis keys
 * as `bull:<queue>:<jobId>` and rejects any custom id containing a colon —
 * which it does at `queue.add` time, so the enqueue throws rather than silently
 * skipping deduplication.
 *
 * Every message gets a **deterministic `jobId`**, and choosing the right key is
 * the whole game — BullMQ treats two jobs with the same id as one, so a key
 * that is too broad silently swallows a legitimate second send and one that is
 * too narrow lets a retry duplicate.
 *
 * Each helper below states its key and why. They are the only sanctioned way to
 * queue these messages; nothing should call `enqueueMail` with a hand-built id.
 */

export async function sendVerifyEmail(args: {
  to: string
  firstName: string | null
  token: string
  tokenId: string
  audience: 'shop' | 'admin'
}): Promise<void> {
  await enqueueMail(
    {
      template: 'auth.verify',
      to: args.to,
      data: { firstName: args.firstName, token: args.token, audience: args.audience },
    },
    {
      priority: MAIL_PRIORITY.INTERACTIVE,
      // Keyed on the token row, not the user: "resend" mints a fresh token and
      // invalidates the old one, so each issued token is its own event and a
      // user-keyed id would make the second link never arrive.
      jobId: `auth.verify-${args.tokenId}`,
    },
  )
}

export async function sendPasswordReset(args: {
  to: string
  firstName: string | null
  token: string
  tokenId: string
  audience: 'shop' | 'admin'
}): Promise<void> {
  await enqueueMail(
    {
      template: 'auth.reset',
      to: args.to,
      data: { firstName: args.firstName, token: args.token, audience: args.audience },
    },
    {
      priority: MAIL_PRIORITY.INTERACTIVE,
      // Same reasoning as verification: one email per token issued.
      jobId: `auth.reset-${args.tokenId}`,
    },
  )
}

export async function sendWelcome(args: { to: string; firstName: string | null; userId: string }): Promise<void> {
  await enqueueMail(
    { template: 'auth.welcome', to: args.to, data: { firstName: args.firstName } },
    {
      // Keyed on the user, and only on the user: an account is welcomed once
      // in its life, however many times a verification link is double-clicked.
      jobId: `auth.welcome-${args.userId}`,
    },
  )
}

export async function sendOrderConfirmation(args: {
  to: string
  orderId: string
}): Promise<void> {
  await enqueueMail(
    { template: 'order.confirmation', to: args.to, data: { orderId: args.orderId } },
    {
      // Keyed on the order. Providers retry webhooks and reconciliation runs
      // the same handler on a schedule, so this path is entered repeatedly by
      // design — the unique index stops the duplicate order, this stops the
      // duplicate email.
      jobId: `order.confirmation-${args.orderId}`,
    },
  )
}

export async function sendOrderShipped(args: {
  to: string
  orderId: string
  statusHistoryId: string
}): Promise<void> {
  await enqueueMail(
    { template: 'order.shipped', to: args.to, data: { orderId: args.orderId } },
    {
      /**
       * Keyed on the status-history row, **not** the order — the one key on
       * this list where the obvious choice is wrong.
       *
       * `order-status.ts` deliberately permits SHIPPED → PROCESSING, so an
       * operator can ship, correct a mistake, and ship again. Keyed on the
       * order, that second and entirely real shipment would send nothing.
       * Every transition writes its own history row, so that row is the event.
       */
      jobId: `order.shipped-${args.statusHistoryId}`,
    },
  )
}

/**
 * Renders and sends. Called by the worker, and by nothing else.
 *
 * Every failure here throws, because the queue is what turns a throw into a
 * retry with backoff. Catching and logging would report success for an email
 * that was never delivered — the one outcome this whole phase exists to avoid.
 */
export async function processMail(job: MailJobData): Promise<{ messageId: string }> {
  if (!isTemplateName(job.template)) {
    // Not retryable: five attempts will not make an unknown template known. It
    // still throws, so it lands in the failed set where somebody can see it.
    // `String(...)`: the guard above narrows `job.template` to `never` here, and
    // a template literal on `never` is a type error rather than a rendering.
    throw new Error(`Unknown mail template "${String(job.template)}"`)
  }

  const render = templates[job.template] as (data: unknown) => ReturnType<typeof templates[TemplateName]>
  const message = await render(job.data)

  return getProvider().send({
    to: job.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

/**
 * The refund messages.
 *
 * Every key here is the **event**, not the customer and not the order. A
 * cancellation happens once per order, a decision once per request, and a
 * settlement once per refund — and each of those paths is entered more than
 * once by design: webhooks retry, reconciliation runs the same handler on a
 * schedule, and an operator can double-click.
 */

export async function sendOrderCancelled(args: { to: string; orderId: string }): Promise<void> {
  await enqueueMail(
    { template: 'order.cancelled', to: args.to, data: { orderId: args.orderId } },
    {
      // Keyed on the order: `order-status.ts` makes CANCELLED terminal, so an
      // order can only ever be cancelled once.
      jobId: `order.cancelled-${args.orderId}`,
      // Somebody is on the page having just clicked Cancel. This is the one
      // refund message with a person waiting for it.
      priority: MAIL_PRIORITY.INTERACTIVE,
    },
  )
}

export async function sendReturnApproved(args: { to: string; requestId: string }): Promise<void> {
  await enqueueMail(
    { template: 'return.approved', to: args.to, data: { requestId: args.requestId } },
    {
      // Keyed on the request. The decision is a conditional write on REQUESTED,
      // so a second approval never happens — and if it somehow did, the
      // customer should not be told twice to post the same parcel.
      jobId: `return.approved-${args.requestId}`,
    },
  )
}

export async function sendReturnRejected(args: { to: string; requestId: string }): Promise<void> {
  await enqueueMail(
    { template: 'return.rejected', to: args.to, data: { requestId: args.requestId } },
    { jobId: `return.rejected-${args.requestId}` },
  )
}

export async function sendRefundCompleted(args: { to: string; refundId: string }): Promise<void> {
  await enqueueMail(
    { template: 'refund.completed', to: args.to, data: { refundId: args.refundId } },
    {
      /**
       * Keyed on the refund, which is the event — not the order. An order
       * refunded in two parts owes the customer two of these, and keying on the
       * order would send the first and swallow the second.
       */
      jobId: `refund.completed-${args.refundId}`,
    },
  )
}
