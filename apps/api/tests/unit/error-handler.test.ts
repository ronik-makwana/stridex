import { Prisma } from '@shoe/db'
import { MulterError } from 'multer'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { conflict, notFound, unprocessable } from '../../src/lib/errors.js'
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.js'

/**
 * The one place every failure in the API is turned into something a client can
 * read, which makes it the one place a bad mapping is invisible: a 500 where a
 * 409 belonged still "works", and the form just fails to render the field error
 * that would have told the customer what to fix.
 */

/** The two arguments the handler actually touches, and nothing else. */
function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return res
}

type ErrorBody = {
  error: { code: string; message: string; fields?: Record<string, string>; reason?: string }
}

function handle(error: unknown) {
  const res = response()
  errorHandler(error, {} as never, res as never, vi.fn())
  return { status: res.statusCode, body: res.body as ErrorBody }
}

describe('AppError', () => {
  it('answers with its own status and code', () => {
    const { status, body } = handle(notFound('Product'))
    expect(status).toBe(404)
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Product not found' })
  })

  it('passes field errors through so a form can render them inline', () => {
    const { status, body } = handle(conflict('Email is taken', { email: 'Already in use' }))
    expect(status).toBe(409)
    expect(body.error.fields).toEqual({ email: 'Already in use' })
  })

  it('passes a reason through for a refusal the customer has to read', () => {
    const { body } = handle(unprocessable('Cannot cancel', 'It has already shipped.'))
    expect(body.error.reason).toBe('It has already shipped.')
  })

  it('omits fields and reason when there are none, rather than sending nulls', () => {
    const { body } = handle(notFound())
    expect(body.error).not.toHaveProperty('fields')
    expect(body.error).not.toHaveProperty('reason')
  })
})

describe('ZodError', () => {
  const schema = z.object({ email: z.email(), age: z.number().min(18) })

  it('answers 400 with a flat field map', () => {
    const parsed = schema.safeParse({ email: 'nope', age: 12 })
    const { status, body } = handle(parsed.error)

    expect(status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(Object.keys(body.error.fields ?? {})).toEqual(['email', 'age'])
  })

  it('keeps the first message per field rather than the last', () => {
    const parsed = z.object({ name: z.string().min(5).regex(/^[a-z]+$/) }).safeParse({ name: 'A1' })
    const fields = handle(parsed.error).body.error.fields ?? {}
    expect(Object.keys(fields)).toEqual(['name'])
  })
})

describe('Prisma errors', () => {
  const known = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: '7.0.0', meta })

  it('maps a unique violation to 409 with the column as a field error', () => {
    const { status, body } = handle(known('P2002', { target: ['slug'] }))
    expect(status).toBe(409)
    expect(body.error).toMatchObject({ code: 'CONFLICT', fields: { slug: 'Already in use' } })
  })

  it('names every column of a composite unique violation', () => {
    const { body } = handle(known('P2002', { target: ['provider', 'provider_payment_id'] }))
    expect(body.error.fields).toEqual({
      provider: 'Already in use',
      provider_payment_id: 'Already in use',
    })
  })

  it('accepts a bare string target as well as an array', () => {
    const { body } = handle(known('P2002', { target: 'email' }))
    expect(body.error.fields).toEqual({ email: 'Already in use' })
  })

  /**
   * `meta.target` is typed as unknown, and a shape that was neither string nor
   * array used to stringify to '[object Object]' — which the customer then read
   * as the name of the field that was already in use.
   */
  it('says something generic rather than [object Object] for an unreadable target', () => {
    const { status, body } = handle(known('P2002', { target: { column: 'slug' } }))
    expect(status).toBe(409)
    expect(body.error.message).not.toContain('[object Object]')
    expect(body.error.message).toBe('That value is already in use')
    expect(body.error).not.toHaveProperty('fields')
  })

  it('survives a unique violation with no target at all', () => {
    const { status, body } = handle(known('P2002'))
    expect(status).toBe(409)
    expect(body.error.message).toBe('That value is already in use')
  })

  it('maps a foreign key violation to 422, the delete-is-blocked case', () => {
    const { status, body } = handle(known('P2003', { field_name: 'orders_user_id_fkey' }))
    expect(status).toBe(422)
    expect(body.error).toMatchObject({
      code: 'UNPROCESSABLE',
      reason: 'orders_user_id_fkey',
    })
  })

  it('falls back to a readable reason when field_name is not a string', () => {
    const { body } = handle(known('P2003', { field_name: { a: 1 } }))
    expect(body.error.reason).toBe('foreign key constraint')
    expect(body.error.reason).not.toContain('[object Object]')
  })

  it('maps a missing required record to 404', () => {
    const { status, body } = handle(known('P2025'))
    expect(status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('does not claim to understand an unmapped Prisma code', () => {
    const { status, body } = handle(known('P2016'))
    expect(status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  it('answers 400 on a malformed query rather than leaking the query', () => {
    const { status, body } = handle(
      new Prisma.PrismaClientValidationError('bad', { clientVersion: '7.0.0' }),
    )
    expect(status).toBe(400)
    expect(body.error).toMatchObject({ code: 'BAD_REQUEST', message: 'Malformed request' })
  })
})

describe('body-parser errors', () => {
  /** How `express.json()` rejects a body it cannot read. */
  const parseFailure = () =>
    Object.assign(new SyntaxError('Unexpected token o in JSON at position 1'), {
      type: 'entity.parse.failed',
      status: 400,
      expose: true,
      body: 'not json',
    })

  const tooLarge = () =>
    Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
      expose: true,
    })

  /**
   * Not a 500. A malformed body is the client's mistake, and on the webhook
   * route a 5xx tells the provider to retry a body that will never parse.
   */
  it('answers 400 for a body that is not JSON', () => {
    const { status, body } = handle(parseFailure())
    expect(status).toBe(400)
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('answers 413 for a body over the size limit', () => {
    const { status, body } = handle(tooLarge())
    expect(status).toBe(413)
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('does not leak the unparsed body back to the caller', () => {
    expect(JSON.stringify(handle(parseFailure()).body)).not.toContain('not json')
  })

  /**
   * The `entity.` prefix is what separates a body-parser rejection from an
   * ordinary `SyntaxError` thrown inside a service — which is still a 500,
   * because it is our bug and not the caller's.
   */
  it('leaves a plain SyntaxError as a 500', () => {
    expect(handle(new SyntaxError('a bug in a regex')).status).toBe(500)
  })
})

describe('upload errors', () => {
  it('answers 413 for a file over the limit', () => {
    const { status, body } = handle(new MulterError('LIMIT_FILE_SIZE', 'file'))
    expect(status).toBe(413)
    expect(body.error).toMatchObject({
      code: 'UPLOAD_REJECTED',
      fields: { file: 'That file is too large' },
    })
  })

  it('names the offending field for an unexpected file', () => {
    const { status, body } = handle(new MulterError('LIMIT_UNEXPECTED_FILE', 'avatar'))
    expect(status).toBe(400)
    expect(body.error.message).toContain('avatar')
  })

  it('answers 400 for any other upload failure', () => {
    const { status, body } = handle(new MulterError('LIMIT_PART_COUNT', 'file'))
    expect(status).toBe(400)
    expect(body.error.code).toBe('UPLOAD_REJECTED')
  })
})

describe('anything else', () => {
  /**
   * Outside production the message is the real one, which is what makes a
   * failing test readable. `tests/setup/env.ts` sets NODE_ENV=test, so this is
   * the branch under test — the production branch is asserted by reading the
   * same condition, not by mutating a module-level constant mid-run.
   */
  it('answers 500 and does not invent a code', () => {
    const { status, body } = handle(new Error('something exploded'))
    expect(status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  it('does not crash on a thrown non-Error', () => {
    expect(() => handle('a string was thrown')).not.toThrow()
    expect(handle({ weird: true }).status).toBe(500)
  })
})

describe('notFoundHandler', () => {
  it('names the method and path that missed', () => {
    const res = response()
    notFoundHandler({ method: 'POST', path: '/api/storefront/nope' } as never, res as never, vi.fn())

    expect(res.statusCode).toBe(404)
    expect((res.body as ErrorBody).error.message).toBe('Cannot POST /api/storefront/nope')
  })
})
