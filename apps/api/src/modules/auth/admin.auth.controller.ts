import type { Request, RequestHandler, Response } from 'express'
import { prisma } from '../../lib/prisma.js'
import { notFound, unauthorized } from '../../lib/errors.js'
import { ADMIN_ROLES } from '../../middleware/requireRole.js'
import { serializeAdminUser } from '../../serializers/admin/user.serializer.js'
import type {
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
} from '../../schemas/admin/auth.schema.js'
import * as authService from './auth.service.js'
import {
  ADMIN_COOKIE_PATH,
  ADMIN_REFRESH_COOKIE,
  clearRefreshCookie,
  readRefreshCookie,
  sessionContext,
  setRefreshCookie,
} from './auth.cookies.js'

const setAdminCookie = (res: Response, token: string) =>
  setRefreshCookie(res, ADMIN_REFRESH_COOKIE, ADMIN_COOKIE_PATH, token)

/**
 * The access token goes in the JSON body and lives in admin memory only; the
 * refresh token goes in an httpOnly cookie the app can never read. XSS cannot
 * exfiltrate a long-lived credential, and the 15-minute access token limits
 * what it could steal.
 */
export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body as LoginInput

  const { user, tokens } = await authService.login(email, password, ADMIN_ROLES, sessionContext(req))

  setAdminCookie(res, tokens.refreshToken)
  res.status(200).json({
    data: { user: serializeAdminUser(user), accessToken: tokens.accessToken },
  })
}

export const refresh: RequestHandler = async (req, res) => {
  const token = readRefreshCookie(req, ADMIN_REFRESH_COOKIE)
  if (!token) throw unauthorized('No session found')

  try {
    const { user, tokens } = await authService.refresh(token, ADMIN_ROLES, sessionContext(req))
    setAdminCookie(res, tokens.refreshToken)
    res.status(200).json({
      data: { user: serializeAdminUser(user), accessToken: tokens.accessToken },
    })
  } catch (error) {
    // A dead session must not leave a cookie behind that keeps failing.
    clearRefreshCookie(res, ADMIN_REFRESH_COOKIE, ADMIN_COOKIE_PATH)
    throw error
  }
}

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(readRefreshCookie(req, ADMIN_REFRESH_COOKIE))
  clearRefreshCookie(res, ADMIN_REFRESH_COOKIE, ADMIN_COOKIE_PATH)
  res.status(204).end()
}

export const me: RequestHandler = async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) throw notFound('User')
  res.status(200).json({ data: serializeAdminUser(user) })
}

export const forgotPassword: RequestHandler = async (req, res) => {
  const { email } = req.body as ForgotPasswordInput
  // The service queues the email to the admin app's reset URL. Nothing is
  // returned and nothing is logged — the token is a credential.
  await authService.createPasswordResetToken(email, ADMIN_ROLES)

  // Byte-identical whether or not the account exists. In development the token
  // is in the API log; returning it here would rebuild the exact existence
  // oracle this response shape exists to close.
  res.status(202).json({
    data: { message: 'If that email has an admin account, a reset link is on its way.' },
  })
}

export const resetPassword: RequestHandler = async (req, res) => {
  const { token, password } = req.body as ResetPasswordInput
  await authService.resetPassword(token, password, ADMIN_ROLES)
  clearRefreshCookie(res, ADMIN_REFRESH_COOKIE, ADMIN_COOKIE_PATH)
  res.status(200).json({ data: { message: 'Password updated. Sign in with your new password.' } })
}
