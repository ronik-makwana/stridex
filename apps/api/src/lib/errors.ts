export type ErrorFields = Record<string, string>

/** Every error the API deliberately throws. Anything else is a 500. */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly fields?: ErrorFields
  readonly reason?: string

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: { fields?: ErrorFields; reason?: string },
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.fields = options?.fields
    this.reason = options?.reason
  }
}

export const badRequest = (message: string, fields?: ErrorFields) =>
  new AppError(400, 'BAD_REQUEST', message, { fields })

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message)

export const invalidCredentials = () =>
  // Deliberately vague: never leak which half of the pair was wrong.
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message)

export const notFound = (resource = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${resource} not found`)

export const conflict = (message: string, fields?: ErrorFields) =>
  new AppError(409, 'CONFLICT', message, { fields })

export const unprocessable = (message: string, reason?: string) =>
  new AppError(422, 'UNPROCESSABLE', message, { reason })

export const tooManyRequests = (message = 'Too many requests, try again later') =>
  new AppError(429, 'TOO_MANY_REQUESTS', message)
