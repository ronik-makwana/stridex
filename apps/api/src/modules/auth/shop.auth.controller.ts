import type { Request, RequestHandler, Response } from 'express'
import { prisma } from '../../lib/prisma.js'
import { notFound, unauthorized } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { isProduction } from '../../config/env.js'
import { CUSTOMER_ROLES } from '../../middleware/requireRole.js'
import { serializeShopUser } from '../../serializers/shop/user.serializer.js'
import type {
  RegisterInput,
  ResendVerificationInput,
  ShopForgotPasswordInput,
  ShopLoginInput,
  ShopResetPasswordInput,
  VerifyEmailInput,
} from '../../schemas/shop/auth.schema.js'
import * as authService from './auth.service.js'
import {
  SHOP_COOKIE_PATH,
  SHOP_REFRESH_COOKIE,
  clearRefreshCookie,
  readRefreshCookie,
  sessionContext,
  setRefreshCookie,
} from './auth.cookies.js'

const setShopCookie = (res: Response, token: string) =>
  setRefreshCookie(res, SHOP_REFRESH_COOKIE, SHOP_COOKIE_PATH, token)

const clearShopCookie = (res: Response) =>
  clearRefreshCookie(res, SHOP_REFRESH_COOKIE, SHOP_COOKIE_PATH)

/**
 * Until a mailer exists, an issued token goes to the API log and nowhere else.
 * Returning it in the response would be convenient and would also hand every
 * unauthenticated caller a working link for any address they can name.
 */
function logIssuedToken(kind: string, email: string, token: string) {
  logger.info({ email, kind, token: isProduction ? '[redacted]' : token }, `${kind} issued`)
}

/**
 * Signs the customer in immediately and returns a `check your email` flag
 * rather than gating the session on verification. Verification protects the
 * address on file, not the ability to browse, and a store that blocks a
 * paid-for signup behind an inbox round trip loses the order (§22).
 */
export const register: RequestHandler = async (req, res) => {
  const body = req.body as RegisterInput

  const { user, tokens, verificationToken } = await authService.register(
    {
      email: body.email,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName || undefined,
      phone: body.phone || undefined,
    },
    sessionContext(req),
  )

  logIssuedToken('email verification', user.email, verificationToken)

  setShopCookie(res, tokens.refreshToken)
  res.status(201).json({
    data: {
      user: serializeShopUser(user),
      accessToken: tokens.accessToken,
      verificationEmailSent: true,
    },
  })
}

/**
 * The access token goes in the JSON body and lives in a module variable in the
 * tab; the refresh token goes in an httpOnly cookie the app can never read. XSS
 * cannot exfiltrate a long-lived credential, and the 15-minute access token
 * bounds what it could steal.
 *
 * An ADMIN or STAFF account fails here with the same generic message a wrong
 * password gets — see `authService.login`, where wrong-audience is deliberately
 * an authentication failure rather than a 403 that would confirm the address
 * belongs to staff.
 */
export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body as ShopLoginInput

  const { user, tokens } = await authService.login(
    email,
    password,
    CUSTOMER_ROLES,
    sessionContext(req),
  )

  setShopCookie(res, tokens.refreshToken)
  res.status(200).json({
    data: { user: serializeShopUser(user), accessToken: tokens.accessToken },
  })
}

export const refresh: RequestHandler = async (req, res) => {
  const token = readRefreshCookie(req, SHOP_REFRESH_COOKIE)
  if (!token) throw unauthorized('No session found')

  try {
    const { user, tokens } = await authService.refresh(token, CUSTOMER_ROLES, sessionContext(req))
    setShopCookie(res, tokens.refreshToken)
    res.status(200).json({
      data: { user: serializeShopUser(user), accessToken: tokens.accessToken },
    })
  } catch (error) {
    // A dead session must not leave a cookie behind that keeps failing on every
    // page load for the next seven days.
    clearShopCookie(res)
    throw error
  }
}

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(readRefreshCookie(req, SHOP_REFRESH_COOKIE))
  clearShopCookie(res)
  res.status(204).end()
}

export const me: RequestHandler = async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) throw notFound('User')
  res.status(200).json({ data: serializeShopUser(user) })
}

export const verifyEmail: RequestHandler = async (req, res) => {
  const { token } = req.body as VerifyEmailInput
  const user = await authService.verifyEmail(token, CUSTOMER_ROLES)
  // Public on purpose: the link lands in an inbox, and the browser that opens
  // it is often not the one that signed up.
  res.status(200).json({ data: { user: serializeShopUser(user) } })
}

export const resendVerification: RequestHandler = async (req, res) => {
  const { email } = req.body as ResendVerificationInput
  const token = await authService.requestEmailVerification(email, CUSTOMER_ROLES)

  if (token) logIssuedToken('email verification', email, token)

  // Byte-identical whether the address is unknown, already verified, or a staff
  // account. Anything else turns a public endpoint into a customer-list oracle.
  res.status(202).json({
    data: { message: 'If that email needs verifying, a new link is on its way.' },
  })
}

export const forgotPassword: RequestHandler = async (req, res) => {
  const { email } = req.body as ShopForgotPasswordInput
  const token = await authService.createPasswordResetToken(email, CUSTOMER_ROLES)

  if (token) logIssuedToken('password reset', email, token)

  res.status(202).json({
    data: { message: 'If that email has an account, a reset link is on its way.' },
  })
}

export const resetPassword: RequestHandler = async (req, res) => {
  const { token, password } = req.body as ShopResetPasswordInput
  await authService.resetPassword(token, password, CUSTOMER_ROLES)
  // The service revoked every session; drop this browser's cookie too so the
  // next request does not spend a round trip discovering that.
  clearShopCookie(res)
  res.status(200).json({ data: { message: 'Password updated. Sign in with your new password.' } })
}
