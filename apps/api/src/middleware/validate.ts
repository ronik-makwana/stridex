import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError, type ZodType } from 'zod'

type Schemas = {
  body?: ZodType
  query?: ZodType
  params?: ZodType
}

/**
 * Parses and *replaces* the request parts with their parsed output, so
 * downstream handlers get coerced types (numbers, dates, defaults) rather than
 * the raw strings Express hands them.
 *
 * Express 5 makes `req.query` a getter, so it is stashed on `req.validatedQuery`
 * instead of assigned. Read query params from there.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params
      if (schemas.query) {
        Object.defineProperty(req, 'validatedQuery', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
          enumerable: true,
        })
      }
      if (schemas.body) req.body = schemas.body.parse(req.body)
      next()
    } catch (error) {
      next(error instanceof ZodError ? error : error)
    }
  }
}

/** Typed accessor for what `validate({ query })` parsed. */
export function validatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery: T }).validatedQuery
}
