import type { RequestHandler } from 'express'
import { invalidateCatalog } from '../lib/cache.js'
import { logger } from '../lib/logger.js'

/**
 * Drops the catalogue caches after any admin write that could have changed
 * them.
 *
 * **One hook rather than a call in every service**, and that is the point: the
 * alternative is an `invalidate()` at the end of a dozen mutating functions,
 * where the thirteenth is added six months from now by somebody who does not
 * know this exists. A missing invalidation is invisible in tests and shows up
 * as an operator insisting the admin is broken.
 *
 * Fires on `finish`, so it never delays the response, and only for a write that
 * actually succeeded — a rejected validation changed nothing.
 */
const MUTATES = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/** The trees whose writes are visible to a customer. */
const CATALOG = /^\/(products|categories|collections|brands|tags|attributes|variant-options|testimonials|inventory)/

export const invalidateOnWrite: RequestHandler = (req, res, next) => {
  if (!MUTATES.has(req.method) || !CATALOG.test(req.path)) return next()

  res.on('finish', () => {
    if (res.statusCode >= 400) return
    void invalidateCatalog().catch((error) =>
      logger.warn({ err: error, path: req.path }, 'catalog cache invalidation failed'),
    )
  })

  next()
}
