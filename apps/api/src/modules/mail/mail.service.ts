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
    throw new Error(`Unknown mail template "${job.template}"`)
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
