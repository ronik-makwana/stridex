import { Router } from 'express'
import { receive } from '../modules/payments/webhooks.controller.js'

/**
 * `/api/webhooks/*` — mounted outside both the admin and storefront trees.
 *
 * Nothing here is authenticated in the usual sense, and nothing here should
 * ever be. A payment provider has no session with us; it proves who it is by
 * signing the bytes it sends, which the handler checks before reading a single
 * field of the body (§8).
 */
export const webhooksRouter: Router = Router()

// `:provider` is resolved against the registry, so an unknown one is a 500 at
// the first request rather than a silently accepted confirmation.
webhooksRouter.post('/payments/:provider', receive)
