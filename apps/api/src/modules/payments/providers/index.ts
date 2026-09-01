import { env } from '../../../config/env.js'
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

export function getProvider(name = env.PAYMENT_PROVIDER): PaymentProvider {
  const provider = PROVIDERS[name]
  // A misconfigured provider must fail loudly at the first payment, not fall
  // back to something that silently takes no money.
  if (!provider) throw new Error(`Unknown payment provider "${name}"`)
  return provider
}

export type { PaymentProvider } from './provider.types.js'
