import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { UserRole } from '@shoe/db'
import { env } from '../../config/env.js'

export type AccessTokenPayload = {
  sub: string
  email: string
  role: UserRole
  sid: string
}

export type RefreshTokenPayload = {
  sub: string
  sid: string
  jti: string
}

/** "15m" | "7d" | "3600" → milliseconds. */
export function ttlToMs(ttl: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(ttl.trim())
  if (!match) throw new Error(`Unparseable TTL: ${ttl}`)
  const amount = Number(match[1])
  const unit = match[2] ?? 's'
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!
  return amount * multiplier
}

export const ACCESS_TOKEN_MS = ttlToMs(env.ACCESS_TOKEN_TTL)
export const REFRESH_TOKEN_MS = ttlToMs(env.REFRESH_TOKEN_TTL)

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: Math.floor(ACCESS_TOKEN_MS / 1000),
  })
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'jti'>): string {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, env.JWT_REFRESH_SECRET, {
    expiresIn: Math.floor(REFRESH_TOKEN_MS / 1000),
  })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload
}

/**
 * What lands in `user_sessions.refresh_token_hash`. SHA-256 is correct here and
 * argon2 is not: the token is 256 bits of signed randomness, not a human
 * password, so there is nothing to brute force and the lookup stays a single
 * indexed read.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Constant-time compare so a stored-hash check cannot be timed. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex')
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}
