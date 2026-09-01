import { env } from '../../../config/env.js'
import { notFound } from '../../../lib/errors.js'
import { mockProvider } from './mock.provider.js'
import type { PaymentProvider } from './provider.types.js'

/**
 * One provider per name, chosen by configuration rather than by an import
 * somewhere in the service — which is what keeps `payments.service.ts` from
 * knowing that Razorpay exists.
 */
const PROVIDERS: Record<string, PaymentProvider> = {
  [mockProvider.name]: mockProvider,
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
