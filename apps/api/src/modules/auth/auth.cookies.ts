import type { CookieOptions, Response, Request } from 'express'
import { env, isProduction } from '../../config/env.js'
import { REFRESH_TOKEN_MS } from './auth.tokens.js'

/**
 * Distinct cookie names and paths per audience, so an admin session and a
 * customer session coexist in one browser without overwriting each other.
 */
export const ADMIN_REFRESH_COOKIE = 'shoe_admin_refresh'
export const SHOP_REFRESH_COOKIE = 'shoe_shop_refresh'

export const ADMIN_COOKIE_PATH = '/api/admin/auth'
export const SHOP_COOKIE_PATH = '/api/storefront/auth'

function baseOptions(path: string): CookieOptions {
  return {
    httpOnly: true,
    // Lax is enough here: admin.shoe.com and api.shoe.com are the same site, as
    // are localhost:5173 and localhost:4000. `none` would need `secure` and
    // would widen CSRF exposure for nothing.
    sameSite: 'lax',
    secure: isProduction,
    path,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  }
}

export function setRefreshCookie(res: Response, name: string, path: string, token: string) {
  res.cookie(name, token, { ...baseOptions(path), maxAge: REFRESH_TOKEN_MS })
}

export function clearRefreshCookie(res: Response, name: string, path: string) {
  res.clearCookie(name, baseOptions(path))
}

export function readRefreshCookie(req: Request, name: string): string | undefined {
  const value = (req.cookies as Record<string, string> | undefined)?.[name]
  return value || undefined
}

export function sessionContext(req: Request) {
  return {
    userAgent: req.get('user-agent') ?? undefined,
    ipAddress: req.ip ?? undefined,
  }
}
