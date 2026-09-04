import { env } from '../../../config/env.js'
import { notFound } from '../../../lib/errors.js'
import { razorpayProvider } from './razorpay.provider.js'
import type { PaymentProvider } from './provider.types.js'

/**
 * Every provider this deployment can act as.
 *
 * The map is keyed by name rather than collapsed into a single export because
 * refunds and reconciliation resolve their provider from the row they are
 * acting on (`getProvider(row.provider)` in `refunds.service.ts` and both
 * reconcilers), not from `PAYMENT_PROVIDER`. A payment is always settled by
 * whoever took it, which is what makes adding a second provider later a
 * registration rather than a migration.
 *
 * A corollary worth knowing: rows naming a provider that is no longer here
 * cannot be refunded or reconciled. `getProvider` throws below rather than
 * guessing, so the failure names the missing provider instead of quietly
 * settling money through the wrong one.
 */
const PROVIDERS: Record<string, PaymentProvider> = {
  [razorpayProvider.name]: razorpayProvider,
}

/**
 * `name` is a plain string because one caller is a URL segment — a webhook
 * arrives at `/payments/:provider` and the value has not been validated by
 * anything yet. Looking it up here, and failing loudly on a miss, is the
 * validation.
 */
export function getProvider(name: string = env.PAYMENT_PROVIDER): PaymentProvider {
  const provider = PROVIDERS[name]
  // A misconfigured provider must fail loudly at the first payment, not fall
  // back to something that silently takes no money.
  if (!provider) throw notFound(`Payment provider "${name}"`)
  return provider
}

export type { PaymentProvider } from './provider.types.js'
