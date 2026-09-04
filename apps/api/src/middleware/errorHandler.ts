import type { ErrorRequestHandler, RequestHandler } from 'express'
import { Prisma } from '@shoe/db'
import { MulterError } from 'multer'
import { ZodError } from 'zod'
import { AppError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { isProduction } from '../config/env.js'

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  })
}

/**
 * A body-parser rejection, identified by the `type` body-parser stamps on it
 * rather than by `instanceof`: the oversized-body case is a `PayloadTooLargeError`
 * and the malformed case a `SyntaxError`, and only the `entity.*` prefix
 * separates both from an ordinary `SyntaxError` thrown somewhere in a service.
 */
function isBodyParserError(error: unknown): error is Error & { type: string; status?: number } {
  return (
    error instanceof Error &&
    'type' in error &&
    typeof (error as { type?: unknown }).type === 'string' &&
    (error as { type: string }).type.startsWith('entity.')
  )
}

/** Turns a Zod issue tree into the flat `{ field: message }` shape forms want. */
function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] ??= issue.message
  }
  return fields
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
        ...(err.reason ? { reason: err.reason } : {}),
      },
    })
    return
  }

  /**
   * `express.json()` rejects a malformed or oversized body before any route is
   * reached, and throws a plain `SyntaxError`/`PayloadTooLargeError` carrying
   * its own `status` and a `type` of `entity.*`.
   *
   * Without this branch they fell through to the generic 500 below, which is
   * wrong twice over: it logs a client mistake as an unhandled server error,
   * and on `/api/webhooks/*` it tells the provider to **retry** — a redelivery
   * loop over a body that will never parse, which is exactly what the 200-on-
   * anything-unactionable rule in `webhooks.controller.ts` exists to avoid.
   */
  if (isBodyParserError(err)) {
    const tooLarge = err.type === 'entity.too.large'
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        message: tooLarge ? 'That request body is too large' : 'That request body is not valid JSON',
      },
    })
    return
  }

  // Multer rejects before any handler runs, so its errors arrive raw.
  if (err instanceof MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'That file is too large'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Unexpected file field "${err.field}"`
          : 'That upload could not be read'
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: { code: 'UPLOAD_REJECTED', message, fields: { file: message } },
    })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', fields: zodFields(err) },
    })
    return
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 unique violation → 409, with the offending column as a field error
    // so the form can render it inline.
    if (err.code === 'P2002') {
      const target = err.meta?.target
      // `meta.target` is typed as unknown and is a string or an array of them
      // in practice. Anything else stringified to '[object Object]' and told
      // the customer that was already in use.
      const columns = Array.isArray(target)
        ? target.filter((column): column is string => typeof column === 'string')
        : typeof target === 'string'
          ? [target]
          : []
      const fields = Object.fromEntries(columns.map((c) => [c, 'Already in use']))
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: columns.length
            ? `${columns.join(', ')} already in use`
            : 'That value is already in use',
          ...(columns.length ? { fields } : {}),
        },
      })
      return
    }

    // P2003 foreign key violation → 422, the delete-is-blocked case.
    if (err.code === 'P2003') {
      res.status(422).json({
        error: {
          code: 'UNPROCESSABLE',
          message: 'This record is still referenced by other records',
          reason:
            typeof err.meta?.field_name === 'string'
              ? err.meta.field_name
              : 'foreign key constraint',
        },
      })
      return
    }

    // P2025 record required but not found → 404.
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } })
      return
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error({ err }, 'prisma validation error')
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed request' } })
    return
  }

  logger.error({ err }, 'unhandled error')
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Something went wrong' : String((err as Error)?.message ?? err),
    },
  })
}
