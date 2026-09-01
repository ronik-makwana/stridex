import { z } from 'zod'

/**
 * A payment names a checkout session and nothing else. Not an amount — that is
 * read from the session the server quoted (§5, §21) — and not a provider, which
 * is configuration rather than the customer's choice.
 */
export const createPaymentSchema = z.object({
  checkoutSessionId: z.uuid('Not a valid id'),
})

/**
 * The `Idempotency-Key` header, generated once per attempt by the client and
 * reused across every retry of that attempt (§7, §13). A uuid because it has to
 * be unguessable: a predictable key is a way to collide with somebody else's
 * payment on purpose.
 */
export const idempotencyKeySchema = z.uuid('Idempotency-Key must be a uuid')

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>
