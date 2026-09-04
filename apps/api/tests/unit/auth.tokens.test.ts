import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import {
  hashRefreshToken,
  randomToken,
  safeEqual,
  sha256,
  signAccessToken,
  signRefreshToken,
  ttlToMs,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../src/modules/auth/auth.tokens.js'

/**
 * The access token is verified statelessly on every request — no database round
 * trip — so everything that stops a forged or expired one from working lives in
 * this file. The two secrets being genuinely separate is the property that
 * keeps a refresh token from being usable as an access token.
 */

const payload = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'customer@example.com',
  role: 'CUSTOMER' as const,
  sid: '22222222-2222-4222-8222-222222222222',
}

describe('ttlToMs', () => {
  it.each([
    ['15m', 900_000],
    ['7d', 604_800_000],
    ['1h', 3_600_000],
    ['30s', 30_000],
    // A bare number is seconds, which is what jsonwebtoken means by one too.
    ['3600', 3_600_000],
  ])('reads %s', (ttl, expected) => {
    expect(ttlToMs(ttl)).toBe(expected)
  })

  it('tolerates surrounding whitespace', () => {
    expect(ttlToMs('  15m  ')).toBe(900_000)
  })

  it('throws on something it cannot parse rather than guessing', () => {
    expect(() => ttlToMs('fortnight')).toThrow(/Unparseable TTL/)
    expect(() => ttlToMs('15y')).toThrow(/Unparseable TTL/)
    expect(() => ttlToMs('')).toThrow(/Unparseable TTL/)
  })
})

describe('access tokens', () => {
  it('round-trips every claim the request handler reads', () => {
    const verified = verifyAccessToken(signAccessToken(payload))
    expect(verified).toMatchObject(payload)
  })

  it('carries an expiry', () => {
    const decoded = jwt.decode(signAccessToken(payload)) as { exp: number; iat: number }
    expect(decoded.exp - decoded.iat).toBe(900)
  })

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign(payload, 'an-attackers-secret-that-is-long-enough')
    expect(() => verifyAccessToken(forged)).toThrow()
  })

  /** The property that keeps the two token types from being interchangeable. */
  it('rejects a refresh token presented as an access token', () => {
    const refresh = signRefreshToken({ sub: payload.sub, sid: payload.sid })
    expect(() => verifyAccessToken(refresh)).toThrow()
  })

  it('rejects an expired token', () => {
    const expired = jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: -10 })
    expect(() => verifyAccessToken(expired)).toThrow()
  })

  it('rejects a tampered payload', () => {
    const token = signAccessToken(payload)
    const [header, body, signature] = token.split('.')
    const elevated = Buffer.from(JSON.stringify({ ...payload, role: 'ADMIN' })).toString('base64url')
    expect(() => verifyAccessToken(`${header}.${elevated}.${signature}`)).toThrow()
    expect(body).not.toBe(elevated)
  })

  it('rejects a token with no signature at all', () => {
    const unsigned = jwt.sign(payload, '', { algorithm: 'none' })
    expect(() => verifyAccessToken(unsigned)).toThrow()
  })

  it('rejects gibberish', () => {
    expect(() => verifyAccessToken('not.a.token')).toThrow()
    expect(() => verifyAccessToken('')).toThrow()
  })
})

describe('refresh tokens', () => {
  it('round-trips the session it names', () => {
    const verified = verifyRefreshToken(signRefreshToken({ sub: payload.sub, sid: payload.sid }))
    expect(verified).toMatchObject({ sub: payload.sub, sid: payload.sid })
  })

  /**
   * A fresh `jti` per token is what makes rotation detectable: two refreshes of
   * the same session are distinguishable rows rather than the same string.
   */
  it('mints a unique jti every time, so rotation can be tracked', () => {
    const first = verifyRefreshToken(signRefreshToken({ sub: payload.sub, sid: payload.sid }))
    const second = verifyRefreshToken(signRefreshToken({ sub: payload.sub, sid: payload.sid }))

    expect(first.jti).toBeTruthy()
    expect(first.jti).not.toBe(second.jti)
  })

  it('rejects an access token presented as a refresh token', () => {
    expect(() => verifyRefreshToken(signAccessToken(payload))).toThrow()
  })

  it('carries the longer expiry', () => {
    const token = signRefreshToken({ sub: payload.sub, sid: payload.sid })
    const decoded = jwt.decode(token) as { exp: number; iat: number }
    expect(decoded.exp - decoded.iat).toBe(604_800)
  })
})

describe('hashing', () => {
  it('hashes a refresh token deterministically, so the row can be found again', () => {
    const token = randomToken()
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token))
  })

  it('produces a different hash for a different token', () => {
    expect(hashRefreshToken(randomToken())).not.toBe(hashRefreshToken(randomToken()))
  })

  it('does not store the token itself', () => {
    const token = randomToken()
    expect(hashRefreshToken(token)).not.toContain(token)
    expect(hashRefreshToken(token)).toHaveLength(64)
  })

  it('agrees with sha256, which is what the verification tokens use', () => {
    const value = randomToken()
    expect(hashRefreshToken(value)).toBe(sha256(value))
  })
})

describe('randomToken', () => {
  it('is hex of the requested byte length', () => {
    expect(randomToken(32)).toMatch(/^[0-9a-f]{64}$/)
    expect(randomToken(16)).toMatch(/^[0-9a-f]{32}$/)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken()))
    expect(seen.size).toBe(200)
  })
})

describe('safeEqual', () => {
  it('is true for identical strings', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true)
  })

  it('is false for different strings of the same length', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false)
  })

  /** Different lengths must short-circuit rather than throw out of timingSafeEqual. */
  it('is false, not an exception, for different lengths', () => {
    expect(safeEqual('short', 'considerably-longer')).toBe(false)
  })

  it('handles empty strings', () => {
    expect(safeEqual('', '')).toBe(true)
    expect(safeEqual('', 'x')).toBe(false)
  })
})
