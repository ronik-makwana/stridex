import { renderTestMail, type TestMailData } from './test.template.js'
import {
  renderResetPassword,
  renderVerifyEmail,
  renderWelcome,
  type ResetPasswordData,
  type VerifyEmailData,
  type WelcomeData,
} from './auth.templates.js'
import {
  renderOrderConfirmation,
  renderOrderShipped,
  type OrderMailData,
} from './order.templates.js'
import type { RenderedMail } from './layout.js'

/**
 * Every email the system can send, by name.
 *
 * The name is what travels in the job payload, so this map is the contract
 * between whoever enqueues and the worker that renders.
 *
 * **Renderers take data, and for anything with a database behind it that data
 * is ids.** A renderer reads its own rows so the email reflects the database at
 * send time rather than at enqueue time, and so a payload never carries a
 * price, an address, or anything else with a canonical home. The auth
 * templates are the deliberate exception — a raw token cannot be re-read.
 */
export type Renderer<TData> = (data: TData) => RenderedMail | Promise<RenderedMail>

export const templates = {
  'mail.test': renderTestMail as Renderer<TestMailData>,
  'auth.verify': renderVerifyEmail as Renderer<VerifyEmailData>,
  'auth.reset': renderResetPassword as Renderer<ResetPasswordData>,
  'auth.welcome': renderWelcome as Renderer<WelcomeData>,
  'order.confirmation': renderOrderConfirmation as Renderer<OrderMailData>,
  'order.shipped': renderOrderShipped as Renderer<OrderMailData>,
} satisfies Record<string, Renderer<never>>

export type TemplateName = keyof typeof templates

export function isTemplateName(value: string): value is TemplateName {
  return value in templates
}

export type { RenderedMail }
export type { TestMailData, VerifyEmailData, ResetPasswordData, WelcomeData, OrderMailData }
